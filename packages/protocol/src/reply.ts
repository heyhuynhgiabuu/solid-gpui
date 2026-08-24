import type { ProtocolError, Result } from "./batch"

/** Machine-readable cause of an error reply. Mirrors Rust `ReplyCode`.
 * decodeFailed: seq is null (line untrustworthy). applyFailed: seq is set
 * (correlates to the caller). unsupported: valid command, wrong helper mode.
 * unknownCommand: command name outside the closed set. */
export type ReplyCode = "decodeFailed" | "applyFailed" | "unsupported" | "unknownCommand"

/** JSON value type for Result reply payloads (getStats objects, captureFrame
 * metadata). Kept permissive: each command defines its own shape. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[]

const REPLY_CODES: readonly ReplyCode[] = [
  "decodeFailed",
  "applyFailed",
  "unsupported",
  "unknownCommand",
]

/** Helper→JS wire message: exactly one reply per received batch line. */
export type Reply =
  | { readonly type: "ack"; readonly seq: number; readonly applied: number }
  | {
      readonly type: "error"
      readonly seq: number | null
      readonly code: ReplyCode
      readonly message: string
    }
  | { readonly type: "result"; readonly seq: number; readonly value: JsonValue }

export type ErrorReply = Extract<Reply, { type: "error" }>
export type ResultReply = Extract<Reply, { type: "result" }>

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max

const shape = (path: string, message: string): ProtocolError => ({
  kind: "invalidShape",
  path,
  message,
})

const isDict = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const isJsonValue = (v: unknown): v is JsonValue => {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return true
  }
  if (Array.isArray(v)) return v.every(isJsonValue)
  if (isDict(v)) return Object.values(v).every(isJsonValue)
  return false
}

/** Decode one reply line. Recoverable failures are Result errors, never thrown. */
export function decodeReply(json: string): Result<Reply, ProtocolError> {
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

  switch (parsed.type) {
    case "ack": {
      if (!isInt(parsed.seq, 0, 0xffff_ffff)) {
        return { ok: false, error: shape("seq", "expected an integer in 0..=4294967295") }
      }
      if (!isInt(parsed.applied, 0, 0xffff_ffff)) {
        return { ok: false, error: shape("applied", "expected an integer in 0..=4294967295") }
      }
      return { ok: true, value: { type: "ack", seq: parsed.seq, applied: parsed.applied } }
    }
    case "error": {
      const seq = parsed.seq
      if (seq !== null && !isInt(seq, 0, 0xffff_ffff)) {
        return { ok: false, error: shape("seq", "expected null or an integer") }
      }
      const code = parsed.code
      if (typeof code !== "string" || !(REPLY_CODES as readonly string[]).includes(code)) {
        return { ok: false, error: shape("code", `expected one of ${REPLY_CODES.join("|")}`) }
      }
      const message = parsed.message
      if (typeof message !== "string") {
        return { ok: false, error: shape("message", "expected a string") }
      }
      return { ok: true, value: { type: "error", seq, code: code as ReplyCode, message } }
    }
    case "result": {
      if (!isInt(parsed.seq, 0, 0xffff_ffff)) {
        return { ok: false, error: shape("seq", "expected an integer in 0..=4294967295") }
      }
      // Payload shape is command-specific; presence + JSON-ness is all the
      // wire-level decoder guarantees.
      const payload = parsed.value
      if (!isJsonValue(payload)) {
        return { ok: false, error: shape("value", "expected a JSON payload") }
      }
      return { ok: true, value: { type: "result", seq: parsed.seq, value: payload } }
    }
    default:
      return { ok: false, error: shape("type", 'expected "ack", "error" or "result"') }
  }
}
