import type { ProtocolError, Result } from "./batch"

/**
 * JS→helper request that is NOT a mutation batch. The `type` field carries
 * the command name; the demuxer matches it against this closed set after the
 * reply and event decoders decline.
 */
export type SolidGpuiCommand =
  | { readonly type: "getStats"; readonly seq: number }
  | { readonly type: "captureFrame"; readonly seq: number; readonly path: string }
  | { readonly type: "scrollTo"; readonly seq: number; readonly id: number; readonly x: number; readonly y: number }
  | { readonly type: "getScrollOffset"; readonly seq: number; readonly id: number }
  | { readonly type: "focusElement"; readonly seq: number; readonly id: number }
  | { readonly type: "simulateInput"; readonly seq: number; readonly id: number; readonly text: string }
  | { readonly type: "listInfo"; readonly seq: number; readonly id: number }
  | { readonly type: "setTitle"; readonly seq: number; readonly title: string }
  | { readonly type: "windowAction"; readonly seq: number; readonly action: WindowActionName }
  | {
      readonly type: "dialogMessage"
      readonly seq: number
      readonly level: DialogLevel
      readonly message: string
      readonly detail?: string
      readonly answers: readonly string[]
    }
  | {
      readonly type: "dialogOpenFile"
      readonly seq: number
      readonly files?: boolean
      readonly directories?: boolean
      readonly multiple?: boolean
      readonly prompt?: string
    }
  | {
      readonly type: "dialogSaveFile"
      readonly seq: number
      readonly directory?: string
      readonly suggestedName?: string
    }
  | { readonly type: "shellRevealPath"; readonly seq: number; readonly path: string }
  | { readonly type: "shellOpenPath"; readonly seq: number; readonly path: string }

export type WindowActionName = "minimize" | "zoom" | "toggleFullscreen" | "activate"
export type DialogLevel = "info" | "warning" | "critical"
export const WINDOW_ACTIONS: readonly WindowActionName[] = ["minimize", "zoom", "toggleFullscreen", "activate"]
export const DIALOG_LEVELS: readonly DialogLevel[] = ["info", "warning", "critical"]

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v)

class FieldError extends Error {
  constructor(readonly field: string) {
    super(field)
  }
}

const isDict = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const shape = (path: string, message: string): ProtocolError => ({
  kind: "invalidShape",
  path,
  message,
})

/** Decode one command line. Recoverable failures are Result errors, never thrown. */
export function decodeCommand(json: string): Result<SolidGpuiCommand, ProtocolError> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    return {
      ok: false,
      error: { kind: "invalidJson", message: e instanceof Error ? e.message : String(e) },
    }
  }
  if (!isDict(parsed)) return { ok: false, error: shape("$", "expected an object") }

  const type = parsed.type
  const KNOWN = [
    "getStats",
    "captureFrame",
    "scrollTo",
    "getScrollOffset",
    "focusElement",
    "simulateInput",
    "listInfo",
    "setTitle",
    "windowAction",
    "dialogMessage",
    "dialogOpenFile",
    "dialogSaveFile",
    "shellRevealPath",
    "shellOpenPath",
  ]
  if (!KNOWN.includes(type as string)) {
    return {
      ok: false,
      error: shape("type", `unknown command ${JSON.stringify(type ?? null)}`),
    }
  }
  if (!isInt(parsed.seq) || parsed.seq < 0 || parsed.seq > 0xffff_ffff) {
    return { ok: false, error: shape("seq", "expected an integer in 0..=4294967295") }
  }

  if (type === "captureFrame") {
    if (typeof parsed.path !== "string" || parsed.path.length === 0) {
      return { ok: false, error: shape("path", "expected a non-empty string") }
    }
    return { ok: true, value: { type, seq: parsed.seq, path: parsed.path } }
  }
  if (type === "simulateInput") {
    const id = parsed.id
    if (!isInt(id) || id < 1 || id > 0xffff_ffff) {
      return { ok: false, error: shape("id", "expected an integer in 1..=4294967295") }
    }
    const text = parsed.text
    if (typeof text !== "string") {
      return { ok: false, error: shape("text", "expected a string") }
    }
    return { ok: true, value: { type, seq: parsed.seq, id, text } }
  }
  if (type === "scrollTo" || type === "getScrollOffset") {
    // Locals first: typeof/isInt guards narrow plain bindings, not
    // property accesses on a Record<string, unknown>.
    const id = parsed.id
    const x = parsed.x
    const y = parsed.y
    const badId = !isInt(id) || (id as number) < 1 || (id as number) > 0xffff_ffff
    if (type === "scrollTo") {
      if (badId || typeof x !== "number" || typeof y !== "number") {
        return {
          ok: false,
          error: shape("id/x/y", "scrollTo needs integer id and numeric x/y"),
        }
      }
      // Literal type fields: `type` is `unknown` and TS cannot narrow it
      // across nested ifs (false-branch of a literal check on unknown stays
      // unknown), so spell the variant name out here.
      return { ok: true, value: { type: "scrollTo", seq: parsed.seq, id, x, y } }
    }
    if (badId) {
      return { ok: false, error: shape("id", "getScrollOffset needs an integer id") }
    }
    return { ok: true, value: { type: "getScrollOffset", seq: parsed.seq, id } }
  }
  if (type === "listInfo") {
    const id = parsed.id
    const badId = !isInt(id) || (id as number) < 1 || (id as number) > 0xffff_ffff
    if (badId) {
      return { ok: false, error: shape("id", "listInfo needs an integer id") }
    }
    return { ok: true, value: { type: "listInfo", seq: parsed.seq, id } }
  }
  if (type === "setTitle") {
    if (typeof parsed.title !== "string" || parsed.title.length === 0) {
      return { ok: false, error: shape("title", "expected a non-empty string") }
    }
    return { ok: true, value: { type: "setTitle", seq: parsed.seq, title: parsed.title } }
  }
  if (type === "windowAction") {
    if (typeof parsed.action !== "string" || !WINDOW_ACTIONS.includes(parsed.action as WindowActionName)) {
      return { ok: false, error: shape("action", "unknown window action") }
    }
    return { ok: true, value: { type: "windowAction", seq: parsed.seq, action: parsed.action as WindowActionName } }
  }
  if (type === "dialogMessage") {
    if (typeof parsed.level !== "string" || !DIALOG_LEVELS.includes(parsed.level as DialogLevel)) {
      return { ok: false, error: shape("level", "unknown dialog level") }
    }
    if (typeof parsed.message !== "string" || parsed.message.length === 0) {
      return { ok: false, error: shape("message", "expected a non-empty string") }
    }
    if (parsed.detail !== undefined && typeof parsed.detail !== "string") {
      return { ok: false, error: shape("detail", "expected a string") }
    }
    if (!Array.isArray(parsed.answers) || parsed.answers.length === 0 || parsed.answers.some((a: unknown) => typeof a !== "string" || a.length === 0)) {
      return { ok: false, error: shape("answers", "expected a non-empty string array") }
    }
    return {
      ok: true,
      value: {
        type: "dialogMessage",
        seq: parsed.seq,
        level: parsed.level as DialogLevel,
        message: parsed.message,
        ...(parsed.detail !== undefined ? { detail: parsed.detail } : {}),
        answers: parsed.answers as string[],
      },
    }
  }
  const optionalBool = (field: string): boolean | undefined => {
    const v = (parsed as Record<string, unknown>)[field]
    if (v === undefined) return undefined
    if (typeof v !== "boolean") throw new FieldError(field)
    return v
  }
  if (type === "dialogOpenFile") {
    try {
      return {
        ok: true,
        value: {
          type: "dialogOpenFile",
          seq: parsed.seq,
          ...(optionalBool("files") !== undefined ? { files: optionalBool("files") } : {}),
          ...(optionalBool("directories") !== undefined ? { directories: optionalBool("directories") } : {}),
          ...(optionalBool("multiple") !== undefined ? { multiple: optionalBool("multiple") } : {}),
          ...(typeof parsed.prompt === "string" ? { prompt: parsed.prompt } : {}),
        },
      }
    } catch (e) {
      if (e instanceof FieldError) return { ok: false, error: shape(e.field, "expected a boolean") }
      throw e
    }
  }
  if (type === "dialogSaveFile") {
    if (parsed.directory !== undefined && typeof parsed.directory !== "string") {
      return { ok: false, error: shape("directory", "expected a string") }
    }
    if (parsed.suggestedName !== undefined && typeof parsed.suggestedName !== "string") {
      return { ok: false, error: shape("suggestedName", "expected a string") }
    }
    return {
      ok: true,
      value: {
        type: "dialogSaveFile",
        seq: parsed.seq,
        ...(parsed.directory !== undefined ? { directory: parsed.directory } : {}),
        ...(parsed.suggestedName !== undefined ? { suggestedName: parsed.suggestedName } : {}),
      },
    }
  }
  if (type === "shellRevealPath" || type === "shellOpenPath") {
    if (typeof parsed.path !== "string" || parsed.path.length === 0) {
      return { ok: false, error: shape("path", "expected a non-empty string") }
    }
    return { ok: true, value: { type, seq: parsed.seq, path: parsed.path } as SolidGpuiCommand }
  }
  if (type === "focusElement") {
    const id = parsed.id
    const badId = !isInt(id) || (id as number) < 1 || (id as number) > 0xffff_ffff
    if (badId) {
      return { ok: false, error: shape("id", "focusElement needs an integer id") }
    }
    return { ok: true, value: { type: "focusElement", seq: parsed.seq, id } }
  }
  // Fallthrough: every other known type returned above, so this is getStats.
  return { ok: true, value: { type: "getStats", seq: parsed.seq } }
}

/** Encode a command to one JSON line. Field order matches the Rust encoder's
 * canonical output so byte-level fixture comparisons hold on both sides. */
export function encodeCommand(command: SolidGpuiCommand): string {
  if (command.type === "captureFrame") {
    return JSON.stringify({
      type: "captureFrame",
      seq: command.seq,
      path: command.path,
    })
  }
  if (command.type === "scrollTo") {
    return JSON.stringify({
      type: "scrollTo",
      seq: command.seq,
      id: command.id,
      x: command.x,
      y: command.y,
    })
  }
  if (command.type === "getScrollOffset") {
    return JSON.stringify({
      type: "getScrollOffset",
      seq: command.seq,
      id: command.id,
    })
  }
  if (command.type === "focusElement") {
    return JSON.stringify({
      type: "focusElement",
      seq: command.seq,
      id: command.id,
    })
  }
  if (command.type === "simulateInput") {
    return JSON.stringify({
      type: "simulateInput",
      seq: command.seq,
      id: command.id,
      text: command.text,
    })
  }
  if (command.type === "listInfo") {
    return JSON.stringify({
      type: "listInfo",
      seq: command.seq,
      id: command.id,
    })
  }
  return JSON.stringify({ type: "getStats", seq: command.seq })
}
