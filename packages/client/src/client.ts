import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  decodeCommand,
  decodeEvent,
  decodeReply,
  encodeBatch,
  encodeCommand,
  type ErrorReply,
  type JsonValue,
  type MutationBatch,
  type SolidGpuiCommand,
  type SolidGpuiEvent,
} from "@solid-gpui/protocol"

/** Ack for one applied batch.
 *
 * `applied` counts mutations that passed retained-tree validation in window
 * mode; transport mode (`--stdio`) reports the decoded count (no tree).
 */
export interface Ack {
  readonly seq: number
  readonly applied: number
}

/** The helper process died; all pending sends reject with this. */
export class HelperExitedError extends Error {
  readonly _tag = "HelperExitedError" as const
  constructor(
    readonly code: number | null,
    readonly signal: string | null,
    readonly spawnError?: string,
  ) {
    const cause = spawnError ? `: ${spawnError}` : ""
    super(`solid-gpui helper exited (code=${code}, signal=${signal})${cause}`)
    this.name = "HelperExitedError"
  }
}

/** The helper answered an error reply for a correlated seq. */
export class ReplyError extends Error {
  readonly _tag = "ReplyError" as const
  constructor(
    readonly code: string,
    readonly message: string,
  ) {
    super(`helper reply error (${code}): ${message}`)
    this.name = "ReplyError"
  }
}

export interface ExitInfo {
  readonly code: number | null
  readonly signal: string | null
  /** Set when the process failed to spawn (Node 'error' event): e.g. ENOENT. */
  readonly error?: string
}

export interface HelperOptions {
  /** Path to the helper binary. Default: repo target/debug build (dev mode). */
  readonly binary?: string
  /** `"transport"` (default): `--stdio`, no GUI. `"window"`: `--stdio-window`. */
  readonly mode?: "transport" | "window"
  /** Extra args appended after the mode flag. */
  readonly args?: readonly string[]
  /** Error replies we cannot correlate to a pending seq. */
  readonly onUnmatchedReply?: (reply: ErrorReply) => void
}
function defaultBinary(): string {
  // Runtime-agnostic equivalent of import.meta.dir (works in Bun and Node).
  const here = fileURLToPath(new URL(".", import.meta.url))
  return resolve(here, "../../../target/debug/solid-gpui-helper")
}

type Pending = {
  resolve: (ack: Ack) => void
  reject: (err: Error) => void
}

type EventListener = (event: SolidGpuiEvent) => void

type CommandPending = {
  resolve: (value: JsonValue) => void
  reject: (err: Error) => void
}

class HelperConnection {
  private readonly pending = new Map<number, Pending>()
  private readonly eventListeners: EventListener[] = []
  private readonly pendingCommands = new Map<number, CommandPending>()
  private closed = false
  private exitInfo: ExitInfo | null = null
  private exitedResolve!: (info: ExitInfo) => void
  readonly exited: Promise<ExitInfo>

  constructor(
    private readonly child: ChildProcess,
    private readonly opts: HelperOptions,
  ) {
    this.exited = new Promise<ExitInfo>((res) => {
      this.exitedResolve = res
    })
    const stdout = child.stdout
    if (stdout) {
      createInterface({ input: stdout }).on("line", (line) => this.onLine(line))
    }
    // EPIPE on stdin writes after death is expected; the exit handler owns it.
    child.stdin?.on("error", () => {})
    // 'close' (not 'exit'): fires only after stdio drained, so a final flushed
    // ack is processed before pending is rejected (Node can emit 'exit' first).
    child.on("close", (code, signal) => this.onExit(code, signal))
    // Spawn failures (Node): 'error' fires and 'close' never does — surface it
    // instead of crashing on an unhandled event.
    child.on("error", (err) => this.onExit(null, null, err))
  }

  private onLine(line: string): void {
    if (!line.trim()) return
    // Demultiplex by wire family: replies answer batches (correlated by seq);
    // events are async user input pushed between batches.
    const r = decodeReply(line)
    if (!r.ok) {
      const e = decodeEvent(line)
      if (e.ok) {
        for (const listener of this.eventListeners) listener(e.value)
        return
      }
      const message = `undecodable reply line: ${JSON.stringify(r.error)}`
      if (this.opts.onUnmatchedReply) {
        this.opts.onUnmatchedReply({
          type: "error",
          seq: null,
          code: "decodeFailed",
          message,
        })
      } else {
        // Loud by default: a garbage reply means a helper bug; the pending
        // batch for it would otherwise hang silently.
        console.warn(`[solid-gpui] ${message}`)
      }
      return
    }
    const reply = r.value
    if (reply.type === "result") {
      const p = this.pendingCommands.get(reply.seq)
      this.pendingCommands.delete(reply.seq)
      p?.resolve(reply.value)
      return
    }
    if (reply.type === "ack") {
      const p = this.pending.get(reply.seq)
      this.pending.delete(reply.seq)
      p?.resolve({ seq: reply.seq, applied: reply.applied })
      return
    }
    if (reply.seq !== null) {
      const p = this.pending.get(reply.seq)
      this.pending.delete(reply.seq)
      p?.reject(new ReplyError(reply.code, reply.message))
      return
    }
    this.opts.onUnmatchedReply?.(reply)
  }

  private onExit(code: number | null, signal: string | null, error?: Error): void {
    if (this.closed) return
    this.closed = true
    this.exitInfo = { code, signal, error: error?.message }
    for (const p of this.pending.values()) {
      p.reject(new HelperExitedError(code, signal, error?.message))
    }
    this.pending.clear()
    for (const p of this.pendingCommands.values()) {
      p.reject(new HelperExitedError(code, signal, error?.message))
    }
    this.pendingCommands.clear()
    this.exitedResolve(this.exitInfo)
  }

  /** Send one batch; resolves on its ack, rejects on its error reply or death.
   *
   * Reusing a seq while its previous batch is still in flight is a caller bug
   * (acks are correlated by seq) and rejects immediately.
   */
  sendBatch(batch: MutationBatch): Promise<Ack> {
    if (this.closed) {
      return Promise.reject(
        new HelperExitedError(
          this.exitInfo?.code ?? null,
          this.exitInfo?.signal ?? null,
          this.exitInfo?.error,
        ),
      )
    }
    if (this.pending.has(batch.seq)) {
      return Promise.reject(
        new Error(`sendBatch: seq ${batch.seq} is already in flight; acks correlate by seq`),
      )
    }
    return new Promise<Ack>((resolve, reject) => {
      try {
        this.child.stdin?.write(encodeBatch(batch) + "\n")
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      // Set after a successful write so a throwing write leaves no stale entry;
      // the ack cannot arrive before the next event-loop turn.
      this.pending.set(batch.seq, { resolve, reject })
    })
  }

  /** Send one command; resolves with its Result payload, rejects on an error
   * reply or death. Commands use their own seq space — reusing a seq while a
   * command is in flight is a caller bug and rejects immediately.
   */
  sendCommand(command: SolidGpuiCommand): Promise<JsonValue> {
    if (this.closed) {
      return Promise.reject(
        new HelperExitedError(
          this.exitInfo?.code ?? null,
          this.exitInfo?.signal ?? null,
          this.exitInfo?.error,
        ),
      )
    }
    if (this.pendingCommands.has(command.seq)) {
      return Promise.reject(
        new Error(`sendCommand: seq ${command.seq} is already in flight`),
      )
    }
    return new Promise<JsonValue>((resolve, reject) => {
      try {
        this.child.stdin?.write(encodeCommand(command) + "\n")
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      // Set after a successful write; the reply cannot arrive before the next
      // event-loop turn.
      this.pendingCommands.set(command.seq, { resolve, reject })
    })
  }

  /** Subscribe to helper→JS input events (clicks). Returns an unsubscribe fn. */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.push(listener)
    return () => {
      const i = this.eventListeners.indexOf(listener)
      if (i >= 0) this.eventListeners.splice(i, 1)
    }
  }

  /** Signal-death (SIGTERM) — for tests and manual teardown. */
  kill(): void {
    if (!this.closed) this.child.kill()
  }

  /** Graceful close: end stdin (helper exits 0 on EOF) and await exit. */
  async close(): Promise<void> {
    if (!this.closed) this.child.stdin?.end()
    await this.exited
  }
}

/** Spawn the native helper in `--stdio` transport mode and supervise it.
 *
 * Bun throws synchronously from spawn() on ENOENT — rethrown as
 * HelperExitedError. Node reports spawn failure asynchronously via the
 * connection's `exited` info (`error` field) and pending rejections.
 */
export function spawnHelper(opts: HelperOptions = {}): HelperConnection {
  const binary = opts.binary ?? defaultBinary()
  let child: ChildProcess
  try {
    child = spawn(binary, [opts.mode === "window" ? "--stdio-window" : "--stdio", ...(opts.args ?? [])], {
      stdio: ["pipe", "pipe", "inherit"],
    })
  } catch (err) {
    throw new HelperExitedError(null, null, err instanceof Error ? err.message : String(err))
  }
  return new HelperConnection(child, opts)
}

export type { HelperConnection }
