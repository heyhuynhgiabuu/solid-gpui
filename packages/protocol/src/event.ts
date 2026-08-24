import type { ProtocolError, Result } from "./batch"
import { EVENT_TYPES, type EventType } from "./mutation"

/**
 * Helper→JS asynchronous input event: pushed whenever the user interacts,
 * between batches. The `type: "event"` tag lets the client demultiplex lines
 * cheaply before full decoding.
 */
export type SolidGpuiEvent = {
  readonly type: "event"
  readonly id: number
  readonly eventType: EventType
  readonly x?: number
  readonly y?: number
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v)

const isEventType = (v: unknown): v is EventType =>
  typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v)

const isDict = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const shape = (path: string, message: string): ProtocolError => ({
  kind: "invalidShape",
  path,
  message,
})

/** Decode one event line. Recoverable failures are Result errors, never thrown. */
export function decodeEvent(json: string): Result<SolidGpuiEvent, ProtocolError> {
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
  if (parsed.type !== "event") return { ok: false, error: shape("type", 'expected "event"') }

  if (!isInt(parsed.id) || parsed.id < 1 || parsed.id > 0xffff_ffff) {
    return { ok: false, error: shape("id", "expected an integer in 1..=4294967295") }
  }
  if (!isEventType(parsed.eventType)) {
    return { ok: false, error: shape("eventType", `expected one of ${EVENT_TYPES.join("|")}`) }
  }
  const eventType: EventType = parsed.eventType

  const out: {
    type: "event"
    id: number
    eventType: EventType
    x?: number
    y?: number
  } = { type: "event", id: parsed.id, eventType }

  for (const axis of ["x", "y"] as const) {
    const v = parsed[axis]
    if (v === undefined || v === null) continue
    if (typeof v !== "number") {
      return { ok: false, error: shape(axis, "expected a number or null") }
    }
    out[axis] = v
  }
  return { ok: true, value: out }
}
