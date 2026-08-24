import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  decodeReply,
  encodeBatch,
  type ErrorReply,
  type MutationBatch,
} from "@solid-gpui/protocol"

/** Ack for one applied batch. */
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
  ) {
    super(`solid-gpui helper exited (code=${code}, signal=${signal})`)
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
}

export interface HelperOptions {
  /** Path to the helper binary. Default: repo target/debug build (dev mode). */
  readonly binary?: string
  /** Extra args appended after `--stdio`. */
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

class HelperConnection {
  private readonly pending = new Map<number, Pending>()
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
    child.on("exit", (code, signal) => this.onExit(code, signal))
  }

  private onLine(line: string): void {
    if (!line.trim()) return
    const r = decodeReply(line)
    if (!r.ok) {
      this.opts.onUnmatchedReply?.({
        type: "error",
        seq: null,
        code: "decodeFailed",
        message: `undecodable reply line: ${JSON.stringify(r.error)}`,
      })
      return
    }
    const reply = r.value
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

  private onExit(code: number | null, signal: string | null): void {
    this.closed = true
    this.exitInfo = { code, signal }
    for (const p of this.pending.values()) {
      p.reject(new HelperExitedError(code, signal))
    }
    this.pending.clear()
    this.exitedResolve(this.exitInfo)
  }

  /** Send one batch; resolves on its ack, rejects on its error reply or death. */
  sendBatch(batch: MutationBatch): Promise<Ack> {
    if (this.closed) {
      return Promise.reject(
        new HelperExitedError(this.exitInfo?.code ?? null, this.exitInfo?.signal ?? null),
      )
    }
    return new Promise<Ack>((resolve, reject) => {
      this.pending.set(batch.seq, { resolve, reject })
      this.child.stdin?.write(encodeBatch(batch) + "\n")
    })
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

/** Spawn the native helper in `--stdio` transport mode and supervise it. */
export function spawnHelper(opts: HelperOptions = {}): HelperConnection {
  const binary = opts.binary ?? defaultBinary()
  const child = spawn(binary, ["--stdio", ...(opts.args ?? [])], {
    stdio: ["pipe", "pipe", "inherit"],
  })
  return new HelperConnection(child, opts)
}

export type { HelperConnection }
