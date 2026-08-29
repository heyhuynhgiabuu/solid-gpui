/**
 * Window / dialog / shell commands (P4) over an existing helper connection.
 *
 * These are imperative desktop operations, not tree mutations — they ride
 * the seq-correlated command channel. All functions throw on helper errors
 * (ReplyError) and resolve with typed payloads otherwise.
 *
 * Seq namespace: these use a counter starting at 1_000_000 — far from the
 * renderer's batch counter (1..) and ad-hoc low commands, per the client's
 * disjoint-range contract.
 */
import type { SolidGpuiCommand, JsonValue } from "@solid-gpui/protocol"

/** Desktop commands only need the command channel — accept any connection
 *  shaped like HelperConnection's sendCommand (interface segregation; tests
 *  inject a bare fake). */
export interface CommandChannel {
  sendCommand(command: SolidGpuiCommand): Promise<JsonValue>
}

let nextSeq = 1_000_000

function seq(): number {
  // Wrap at u32 max - the namespace has 4 billion values; wrapping means
  // ~4 billion commands issued, at which point collision with the still-
  // much-lower batch counter is the caller's problem (documented).
  nextSeq = (nextSeq + 1) % 0xffff_ffff
  return nextSeq
}

/** Window title bar + imperative window actions. */
export const appWindow = {
  async setTitle(connection: CommandChannel, title: string): Promise<void> {
    await connection.sendCommand({ type: "setTitle", seq: seq(), title })
  },
  async minimize(connection: CommandChannel): Promise<void> {
    await connection.sendCommand({ type: "windowAction", seq: seq(), action: "minimize" })
  },
  async zoom(connection: CommandChannel): Promise<void> {
    await connection.sendCommand({ type: "windowAction", seq: seq(), action: "zoom" })
  },
  async toggleFullscreen(connection: CommandChannel): Promise<void> {
    await connection.sendCommand({ type: "windowAction", seq: seq(), action: "toggleFullscreen" })
  },
  async activate(connection: CommandChannel): Promise<void> {
    await connection.sendCommand({ type: "windowAction", seq: seq(), action: "activate" })
  },
}

/** Window-scoped semantic theme tokens (README "Theming"). Partial maps
 * merge; unknown token names are ignored helper-side (forward compat). */
export const theme = {
  async set(connection: CommandChannel, tokens: Record<string, string>): Promise<void> {
    await connection.sendCommand({ type: "setTheme", seq: seq(), tokens })
  },
}

/** Modal dialogs; each resolves when the user answers. */
export const dialog = {
  /** Show a message with buttons; resolves with the clicked button's index. */
  async message(
    connection: CommandChannel,
    opts: {
      message: string
      detail?: string
      answers: string[]
      level?: "info" | "warning" | "critical"
    },
  ): Promise<number> {
    // A zero-button dialog is undismissable on macOS (no key equivalents)
    // and would hang the session behind it — reject at the API boundary.
    if (opts.answers.length === 0) {
      throw new Error("[solid-gpui] dialog.message requires at least one answer")
    }
    const r = (await connection.sendCommand({
      type: "dialogMessage",
      seq: seq(),
      level: opts.level ?? "info",
      message: opts.message,
      ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
      answers: opts.answers,
    })) as { answer: number }
    return r.answer
  },
  /** Open-file dialog; resolves with chosen paths, or null when cancelled. */
  async openFile(
    connection: CommandChannel,
    opts?: { files?: boolean; directories?: boolean; multiple?: boolean; prompt?: string },
  ): Promise<string[] | null> {
    const r = (await connection.sendCommand({
      type: "dialogOpenFile",
      seq: seq(),
      ...(opts?.files !== undefined ? { files: opts.files } : {}),
      ...(opts?.directories !== undefined ? { directories: opts.directories } : {}),
      ...(opts?.multiple !== undefined ? { multiple: opts.multiple } : {}),
      ...(opts?.prompt !== undefined ? { prompt: opts.prompt } : {}),
    })) as { paths: string[] | null }
    return r.paths
  },
  /** Save-file dialog; resolves with a path, or null when cancelled. */
  async saveFile(
    connection: CommandChannel,
    opts?: { directory?: string; suggestedName?: string },
  ): Promise<string | null> {
    const r = (await connection.sendCommand({
      type: "dialogSaveFile",
      seq: seq(),
      ...(opts?.directory !== undefined ? { directory: opts.directory } : {}),
      ...(opts?.suggestedName !== undefined ? { suggestedName: opts.suggestedName } : {}),
    })) as { path: string | null }
    return r.path
  },
}

/** OS integrations. */
export const shell = {
  /** Show the path in Finder (platform equivalent). */
  async revealPath(connection: CommandChannel, path: string): Promise<void> {
    await connection.sendCommand({ type: "shellRevealPath", seq: seq(), path })
  },
  /** Hand the path to the application owning its type. */
  async openWithSystem(connection: CommandChannel, path: string): Promise<void> {
    await connection.sendCommand({ type: "shellOpenPath", seq: seq(), path })
  },
}
