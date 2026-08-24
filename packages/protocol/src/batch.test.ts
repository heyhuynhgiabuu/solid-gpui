import { describe, expect, test } from "bun:test"
import fixture from "../fixtures/batch-01.json"
import { elementId } from "./ids"
import { decodeBatch, encodeBatch } from "./batch"
import type { MutationBatch } from "./batch"

const batch: MutationBatch = {
  v: 1,
  seq: 7,
  mutations: [
    { op: "createElement", id: elementId(1), elementType: "div" },
    { op: "setRoot", id: elementId(1) },
    { op: "createElement", id: elementId(2), elementType: "text" },
    { op: "createElement", id: elementId(3), elementType: "div" },
    { op: "appendChild", parentId: elementId(1), childId: elementId(2) },
    { op: "insertBefore", parentId: elementId(1), childId: elementId(3), beforeId: elementId(2) },
    { op: "setStyle", id: elementId(1), style: { display: "flex", gap: 8, opacity: 1 } },
    { op: "setText", id: elementId(2), text: "a\nb — newline must stay escaped" },
    { op: "setEventListener", id: elementId(3), eventType: "click", enabled: true },
    { op: "removeChild", parentId: elementId(1), childId: elementId(3) },
    { op: "destroyElement", id: elementId(3) },
  ],
}

function decoded(json: string) {
  const r = decodeBatch(json)
  if (!r.ok) throw new Error(`decode failed: ${JSON.stringify(r.error)}`)
  return r.value
}

describe("encodeBatch", () => {
  test("output is one NDJSON line (no raw newline)", () => {
    expect(encodeBatch(batch)).not.toContain("\n")
  })

  test("output is parseable JSON", () => {
    expect(() => JSON.parse(encodeBatch(batch))).not.toThrow()
  })
})

describe("decodeBatch round-trip", () => {
  test("decode(encode(batch)) equals batch", () => {
    expect(decoded(encodeBatch(batch))).toEqual(batch)
  })

  test("fixture parses and re-encodes losslessly", () => {
    const json = JSON.stringify(fixture)
    const first = decoded(json)
    expect(first.seq).toBe(42)
    expect(first.mutations.length).toBe(12)
    const setText = first.mutations[8]
    expect(setText && "text" in setText && setText.text).toBe("Xin chào solid-gpui 🎉")
    expect(decoded(encodeBatch(first))).toEqual(first)
  })
})

describe("decodeBatch rejects malformed input", () => {
  test("invalid JSON", () => {
    const r = decodeBatch("{not json")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidJson")
  })

  test("unsupported version", () => {
    const r = decodeBatch(JSON.stringify({ v: 2, seq: 1, mutations: [] }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe("unsupportedVersion")
      if (r.error.kind === "unsupportedVersion") expect(r.error.got).toBe(2)
    }
  })

  test("unknown op", () => {
    const r = decodeBatch(
      JSON.stringify({ v: 1, seq: 1, mutations: [{ op: "teleport", id: 1 }] }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe("unknownOp")
      if (r.error.kind === "unknownOp") expect(r.error.got).toBe("teleport")
    }
  })

  test("unknown event type", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [{ op: "setEventListener", id: 1, eventType: "tap", enabled: true }],
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe("unknownEventType")
      if (r.error.kind === "unknownEventType") expect(r.error.got).toBe("tap")
    }
  })

  test("unknown element type", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [{ op: "createElement", id: 1, elementType: "canvas" }],
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe("unknownElementType")
      if (r.error.kind === "unknownElementType") expect(r.error.got).toBe("canvas")
    }
  })

  test("id 0 is invalid", () => {
    const r = decodeBatch(
      JSON.stringify({ v: 1, seq: 1, mutations: [{ op: "setRoot", id: 0 }] }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe("invalidShape")
      if (r.error.kind === "invalidShape") expect(r.error.path).toBe("mutations[0].id")
    }
  })

  test("non-integer id is invalid", () => {
    const r = decodeBatch(
      JSON.stringify({ v: 1, seq: 1, mutations: [{ op: "setRoot", id: 1.5 }] }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })

  test("negative seq is invalid", () => {
    const r = decodeBatch(JSON.stringify({ v: 1, seq: -1, mutations: [] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })

  test("boolean style value is invalid", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [{ op: "setStyle", id: 1, style: { gap: true } }],
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe("invalidShape")
      if (r.error.kind === "invalidShape") expect(r.error.path).toBe("mutations[0].style.gap")
    }
  })
})
