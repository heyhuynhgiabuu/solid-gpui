import type { ProtocolError, Result } from "./batch"

/**
 * JS→helper request that is NOT a mutation batch. The `type` field carries
 * the command name; the demuxer matches it against this closed set after the
 * reply and event decoders decline.
 */
export type SolidGpuiCommand =
  | { readonly type: "getStats"; readonly seq: number }
  | { readonly type: "captureFrame"; readonly seq: number; readonly path: string }

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
  if (type !== "getStats" && type !== "captureFrame") {
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
  return { ok: true, value: { type, seq: parsed.seq } }
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
  return JSON.stringify({ type: "getStats", seq: command.seq })
}
