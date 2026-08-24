import type { ProtocolError, Result } from "./batch"
import { EVENT_TYPES, type EventType } from "./mutation"

/**
 * Helper→JS asynchronous input event: pushed whenever the user interacts,
 * between batches. The `type: "event"` tag lets the client demultiplex lines
 * cheaply before full decoding.
 */
export type KeyModifiers = {
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly cmd: boolean
}

export type SolidGpuiEvent = {
  readonly type: "event"
  readonly id: number
  readonly eventType: EventType
  readonly x?: number
  readonly y?: number
  readonly key?: string
  readonly modifiers?: KeyModifiers
  /** New document value for change events (input/textarea edits). */
  readonly value?: string
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
    key?: string
    modifiers?: KeyModifiers
    value?: string
  } = { type: "event", id: parsed.id, eventType }

  for (const axis of ["x", "y"] as const) {
    const v = parsed[axis]
    if (v === undefined || v === null) continue
    if (typeof v !== "number") {
      return { ok: false, error: shape(axis, "expected a number or null") }
    }
    out[axis] = v
  }
  if (parsed.key !== undefined && parsed.key !== null) {
    if (typeof parsed.key !== "string") {
      return { ok: false, error: shape("key", "expected a string or null") }
    }
    out.key = parsed.key
  }
  if (parsed.value !== undefined && parsed.value !== null) {
    if (typeof parsed.value !== "string") {
      return { ok: false, error: shape("value", "expected a string or null") }
    }
    out.value = parsed.value
  }
  const mods = parsed.modifiers as Record<string, unknown> | undefined | null
  if (mods !== undefined && mods !== null) {
    if (
      typeof mods !== "object" ||
      typeof mods.ctrl !== "boolean" ||
      typeof mods.alt !== "boolean" ||
      typeof mods.shift !== "boolean" ||
      typeof mods.cmd !== "boolean"
    ) {
      return { ok: false, error: shape("modifiers", "expected {ctrl,alt,shift,cmd} booleans") }
    }
    out.modifiers = {
      ctrl: mods.ctrl,
      alt: mods.alt,
      shift: mods.shift,
      cmd: mods.cmd,
    }
  }
  return { ok: true, value: out }
}
