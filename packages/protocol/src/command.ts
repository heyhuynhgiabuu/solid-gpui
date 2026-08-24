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

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v)

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
  return JSON.stringify({ type: "getStats", seq: command.seq })
}
