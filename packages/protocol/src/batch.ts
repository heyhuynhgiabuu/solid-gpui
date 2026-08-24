import { isElementIdValue, type ElementId } from "./ids"
import {
  ELEMENT_TYPES,
  EVENT_TYPES,
  MUTATION_OPS,
  type ElementType,
  type EventType,
  type Mutation,
  type MutationOp,
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
      return { ok: true, value: { op, id: idR.value, style: style as unknown as StyleMap } }
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
