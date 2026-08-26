import { isElementIdValue, type ElementId } from "./ids"
import {
  ANCHOR_KINDS,
  ANIMATABLE_STYLE_KEYS,
  EASING_NAMES,
  ELEMENT_TYPES,
  EVENT_TYPES,
  MUTATION_OPS,
  STYLE_STATES,
  type DrawItem,
  type ElementType,
  type EventType,
  type Mutation,
  type MutationOp,
  type StyleState,
} from "./mutation"
import type { StyleMap } from "./style"

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export type ProtocolError =
  | { readonly kind: "invalidJson"; readonly message: string }
  | { readonly kind: "unsupportedVersion"; readonly got: number }
  | { readonly kind: "unknownOp"; readonly got: string }
  | { readonly kind: "unknownEventType"; readonly got: string }
  | { readonly kind: "unknownElementType"; readonly got: string }
  | { readonly kind: "invalidShape"; readonly path: string; readonly message: string }

export interface MutationBatch {
  readonly v: 1
  readonly seq: number
  readonly mutations: readonly Mutation[]
}

/**
 * Serialize a batch to a single JSON line.
 *
 * The transport is NDJSON, so the output MUST NOT contain raw newlines —
 * JSON.stringify escapes `\n` inside string values, and a test enforces it.
 */
export function encodeBatch(batch: MutationBatch): string {
  return JSON.stringify(batch)
}

type Dict = { readonly [k: string]: unknown }

const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v)

function decodeDrawItem(
  p: string,
  m: unknown,
): { ok: true; value: DrawItem } | { ok: false; error: ProtocolError } {
  if (typeof m !== "object" || m === null || Array.isArray(m)) {
    return { ok: false, error: shape(p, "expected an object") }
  }
  const o = m as Record<string, unknown>
  const num = (k: string): number | null =>
    typeof o[k] === "number" ? (o[k] as number) : null
  const color = (): string | null =>
    typeof o.color === "string" ? o.color : null
  const xy = (): { x: number; y: number } | null => {
    const x = num("x")
    const y = num("y")
    return x === null || y === null ? null : { x, y }
  }
  switch (o.type) {
    case "rect": {
      const pos = xy()
      const w = num("w")
      const h = num("h")
      const c = color()
      if (pos === null || w === null || h === null || c === null) {
        return { ok: false, error: shape(p, "rect needs numeric x,y,w,h and string color") }
      }
      const cr = num("cornerRadius")
      return { ok: true, value: { type: "rect", x: pos.x, y: pos.y, w, h, color: c, ...(cr === null ? {} : { cornerRadius: cr }) } }
    }
    case "path": {
      const c = color()
      if (c === null) return { ok: false, error: shape(p, "path needs a string color") }
      if (!Array.isArray(o.points) || o.points.some((v) => typeof v !== "number") || o.points.length % 2 !== 0) {
        return { ok: false, error: shape(p, "path points must be complete numeric x,y pairs") }
      }
      const sw = num("strokeWidth")
      const closed = o.closed === undefined ? null : typeof o.closed === "boolean" ? o.closed : null
      return {
        ok: true,
        value: {
          type: "path",
          points: o.points as number[],
          color: c,
          ...(sw === null ? {} : { strokeWidth: sw }),
          ...(closed === null ? {} : { closed }),
        },
      }
    }
    case "text": {
      const pos = xy()
      const size = num("size")
      const c = color()
      if (pos === null || size === null || c === null || typeof o.text !== "string" || o.text.includes("\n")) {
        return { ok: false, error: shape(p, "text needs numeric x,y,size, string text (no newline) and color") }
      }
      return { ok: true, value: { type: "text", x: pos.x, y: pos.y, text: o.text, size, color: c } }
    }
    default:
      return { ok: false, error: shape(`${p}.type`, "expected rect, path, or text") }
  }
}

const shape = (path: string, message: string): ProtocolError => ({
  kind: "invalidShape",
  path,
  message,
})

function requireId(
  dict: Dict,
  key: string,
  path: string,
): Result<ElementId, ProtocolError> {
  const v = dict[key]
  if (!isElementIdValue(v)) {
    return {
      ok: false,
      error: shape(path, `expected an integer id in 1..=4294967295 for "${key}"`),
    }
  }
  // Boundary cast: runtime-validated above; the brand is compile-time only.
  return { ok: true, value: v as ElementId }
}

function decodeMutation(m: Dict, p: string): Result<Mutation, ProtocolError> {
  const opRaw = m.op
  if (typeof opRaw !== "string") {
    return { ok: false, error: shape(`${p}.op`, "expected a string") }
  }
  if (!(MUTATION_OPS as readonly string[]).includes(opRaw)) {
    return { ok: false, error: { kind: "unknownOp", got: opRaw } }
  }
  const op = opRaw as MutationOp

  const id = (key: string = "id") => requireId(m, key, `${p}.${key}`)

  switch (op) {
    case "createElement": {
      const idR = id()
      if (!idR.ok) return idR
      const et = m.elementType
      if (typeof et !== "string") {
        return { ok: false, error: shape(`${p}.elementType`, "expected a string") }
      }
      if (!(ELEMENT_TYPES as readonly string[]).includes(et)) {
        return { ok: false, error: { kind: "unknownElementType", got: et } }
      }
      return { ok: true, value: { op, id: idR.value, elementType: et as ElementType } }
    }
    case "destroyElement":
    case "setRoot": {
      const idR = id()
      if (!idR.ok) return idR
      return { ok: true, value: { op, id: idR.value } as Mutation }
    }
    case "appendChild":
    case "removeChild": {
      const parent = id("parentId")
      if (!parent.ok) return parent
      const child = id("childId")
      if (!child.ok) return child
      return {
        ok: true,
        value: { op, parentId: parent.value, childId: child.value } as Mutation,
      }
    }
    case "insertBefore": {
      const parent = id("parentId")
      if (!parent.ok) return parent
      const child = id("childId")
      if (!child.ok) return child
      const before = id("beforeId")
      if (!before.ok) return before
      return {
        ok: true,
        value: { op, parentId: parent.value, childId: child.value, beforeId: before.value },
      }
    }
    case "setStyle": {
      const idR = id()
      if (!idR.ok) return idR
      const style = m.style
      if (!isDict(style)) {
        return { ok: false, error: shape(`${p}.style`, "expected an object") }
      }
      for (const [k, v] of Object.entries(style)) {
        if (typeof v !== "string" && typeof v !== "number") {
          return { ok: false, error: shape(`${p}.style.${k}`, "expected string or number") }
        }
      }
      // Boundary cast: values validated; unknown keys are intentionally kept
      // (forward compatibility — see StyleMap).
      let state: StyleState | undefined
      if (m.state !== undefined) {
        const raw = m.state as unknown
        if (typeof raw === "string" && STYLE_STATES.includes(raw as StyleState)) {
          state = raw as StyleState
        } else {
          return { ok: false, error: shape(`${p}.state`, "unknown style state") }
        }
      }
      return {
        ok: true,
        value: { op, id: idR.value, style: style as unknown as StyleMap, ...(state ? { state } : {}) },
      }
    }
    case "setAnimation": {
      const idR = id()
      if (!idR.ok) return idR
      const target = m.target
      if (!isDict(target)) {
        return { ok: false, error: shape(`${p}.target`, "expected an object") }
      }
      const keys = Object.keys(target)
      if (keys.length === 0) {
        return { ok: false, error: shape(`${p}.target`, "expected at least one animatable key") }
      }
      for (const k of keys) {
        if (!(ANIMATABLE_STYLE_KEYS as readonly string[]).includes(k)) {
          return {
            ok: false,
            error: shape(
              `${p}.target.${k}`,
              `not animatable; expected one of ${ANIMATABLE_STYLE_KEYS.join("|")}`,
            ),
          }
        }
        if (typeof target[k] !== "number" || !Number.isFinite(target[k])) {
          return {
            ok: false,
            error: shape(`${p}.target.${k}`, "expected a finite number"),
          }
        }
      }
      const transitionMs = m.transitionMs
      if (typeof transitionMs !== "number" || !Number.isInteger(transitionMs) || transitionMs < 0) {
        return {
          ok: false,
          error: shape(`${p}.transitionMs`, "expected a non-negative integer"),
        }
      }
      if (m.easing !== undefined) {
        if (typeof m.easing !== "string" || !(EASING_NAMES as readonly string[]).includes(m.easing)) {
          return {
            ok: false,
            error: shape(`${p}.easing`, `expected one of ${EASING_NAMES.join("|")}`),
          }
        }
      }
      // Boundary cast: keys and values validated above.
      return {
        ok: true,
        value: {
          op,
          id: idR.value,
          target: target as { [k in (typeof ANIMATABLE_STYLE_KEYS)[number]]?: number },
          transitionMs,
          ...(m.easing !== undefined ? { easing: m.easing as (typeof EASING_NAMES)[number] } : {}),
        },
      }
    }
    case "setKeyBindings": {
      const idR = id()
      if (!idR.ok) return idR
      const bindings = m.bindings
      if (!Array.isArray(bindings)) {
        return { ok: false, error: shape(`${p}.bindings`, "expected an array") }
      }
      for (const [i, b] of bindings.entries()) {
        if (typeof b !== "string" || b.trim().length === 0) {
          return { ok: false, error: shape(`${p}.bindings[${i}]`, "expected a non-empty string") }
        }
      }
      return { ok: true, value: { op, id: idR.value, bindings } }
    }
    case "setSrc": {
      const idR = id()
      if (!idR.ok) return idR
      if (typeof m.src !== "string" || m.src.length === 0) {
        return { ok: false, error: shape(`${p}.src`, "expected a non-empty string") }
      }
      return { ok: true, value: { op, id: idR.value, src: m.src } }
    }
    case "setDeferred": {
      const idR = id()
      if (!idR.ok) return idR
      if (typeof m.deferred !== "boolean") {
        return { ok: false, error: shape(`${p}.deferred`, "expected a boolean") }
      }
      return { ok: true, value: { op, id: idR.value, deferred: m.deferred } }
    }
    case "setAnchored": {
      const idR = id()
      if (!idR.ok) return idR
      if (m.anchor !== null && m.anchor !== undefined && !ANCHOR_KINDS.includes(m.anchor as never)) {
        return { ok: false, error: shape(`${p}.anchor`, `expected one of ${ANCHOR_KINDS.join("|")} or null`) }
      }
      return { ok: true, value: { op, id: idR.value, anchor: (m.anchor ?? null) as never } }
    }
    case "setDrawList": {
      const idR = id()
      if (!idR.ok) return idR
      if (!Array.isArray(m.items)) {
        return { ok: false, error: shape(`${p}.items`, "expected an array") }
      }
      const items: DrawItem[] = []
      for (let i = 0; i < m.items.length; i++) {
        const r = decodeDrawItem(`${p}.items[${i}]`, m.items[i])
        if (!r.ok) return r
        items.push(r.value)
      }
      return { ok: true, value: { op, id: idR.value, items } }
    }
    case "setDragData": {
      const idR = id()
      if (!idR.ok) return idR
      if (typeof m.data !== "string") {
        return { ok: false, error: shape(`${p}.data`, "expected a string") }
      }
      return { ok: true, value: { op, id: idR.value, data: m.data } }
    }
    case "setText": {
      const idR = id()
      if (!idR.ok) return idR
      const text = m.text
      if (typeof text !== "string") {
        return { ok: false, error: shape(`${p}.text`, "expected a string") }
      }
      return { ok: true, value: { op, id: idR.value, text } }
    }
    case "setValue": {
      const idR = id()
      if (!idR.ok) return idR
      const value = m.value
      if (typeof value !== "string") {
        return { ok: false, error: shape(`${p}.value`, "expected a string") }
      }
      return { ok: true, value: { op, id: idR.value, value } }
    }
    case "setEventListener": {
      const idR = id()
      if (!idR.ok) return idR
      const et = m.eventType
      if (typeof et !== "string") {
        return { ok: false, error: shape(`${p}.eventType`, "expected a string") }
      }
      if (!(EVENT_TYPES as readonly string[]).includes(et)) {
        return { ok: false, error: { kind: "unknownEventType", got: et } }
      }
      const enabled = m.enabled
      if (typeof enabled !== "boolean") {
        return { ok: false, error: shape(`${p}.enabled`, "expected a boolean") }
      }
      return {
        ok: true,
        value: { op, id: idR.value, eventType: et as EventType, enabled },
      }
    }
  }
}

/**
 * Decode an untrusted batch JSON line. Recoverable failures are returned as
 * `Result` errors, never thrown.
 */
export function decodeBatch(json: string): Result<MutationBatch, ProtocolError> {
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

  const v = parsed.v
  if (v !== 1) {
    if (typeof v === "number" && Number.isInteger(v)) {
      return { ok: false, error: { kind: "unsupportedVersion", got: v } }
    }
    return { ok: false, error: shape("v", "expected the number 1") }
  }

  const seq = parsed.seq
  if (
    typeof seq !== "number" ||
    !Number.isInteger(seq) ||
    seq < 0 ||
    seq > 0xffff_ffff
  ) {
    return { ok: false, error: shape("seq", "expected an integer in 0..=4294967295") }
  }

  const arrRaw = parsed.mutations
  if (!Array.isArray(arrRaw)) {
    return { ok: false, error: shape("mutations", "expected an array") }
  }
  const arr = arrRaw as unknown[]

  const mutations: Mutation[] = []
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i]
    if (!isDict(m)) return { ok: false, error: shape(`mutations[${i}]`, "expected an object") }
    const r = decodeMutation(m, `mutations[${i}]`)
    if (!r.ok) return r
    mutations.push(r.value)
  }

  return { ok: true, value: { v: 1, seq, mutations } }
}
