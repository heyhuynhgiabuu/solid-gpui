import { describe, expect, test } from "bun:test"
import fixture from "../fixtures/batch-01.json"
import rustEmitted from "../fixtures/rust-emitted-batch-01.json"
import listFixture from "../fixtures/batch-list-01.json"
import stateFixture from "../fixtures/batch-style-state-01.json"
import keysFixture from "../fixtures/batch-keys-01.json"
import scrollbarFixture from "../fixtures/batch-scrollbar-01.json"
import dragFixture from "../fixtures/batch-drag-01.json"
import canvasFixture from "../fixtures/batch-canvas-01.json"
import mediaFixture from "../fixtures/batch-media-01.json"
import animationFixture from "../fixtures/batch-animation-01.json"
import markdownFixture from "../fixtures/batch-markdown-01.json"
import textRunsFixture from "../fixtures/batch-text-runs-01.json"
import tooltipFixture from "../fixtures/batch-tooltip-01.json"
import accessibilityFixture from "../fixtures/batch-accessibility-01.json"
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

describe("Rust→TS parity (committed snapshot)", () => {
  test("Rust-emitted JSON decodes to the same batch as the hand-written fixture", () => {
    const fromRust = decoded(JSON.stringify(rustEmitted))
    const fromHand = decoded(JSON.stringify(fixture))
    expect(fromRust).toEqual(fromHand)
  })

  test("Rust-emitted snapshot is a single NDJSON line", () => {
    expect(JSON.stringify(rustEmitted)).not.toContain("\n")
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

  test("input/textarea element types decode (closed set widened)", () => {
    const batch = {
      v: 1,
      seq: 1,
      mutations: [
        { op: "createElement", id: 1, elementType: "input" },
        { op: "createElement", id: 2, elementType: "textarea" },
        { op: "setValue", id: 1, value: "hello" },
      ],
    }
    const r = decodeBatch(JSON.stringify(batch))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const [a, b, c] = r.value.mutations
      expect(a && "elementType" in a && a.elementType).toBe("input")
      expect(b && "elementType" in b && b.elementType).toBe("textarea")
      expect(c && "op" in c && c.op).toBe("setValue")
    }
  })

  test("list element type decodes (closed set widened)", () => {
    const r = decodeBatch(
      JSON.stringify({ v: 1, seq: 1, mutations: [{ op: "createElement", id: 1, elementType: "list" }] }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      const m = r.value.mutations[0]
      expect(m && "elementType" in m && m.elementType).toBe("list")
    }
  })

  test("list batch fixture parses (Rust↔TS parity)", () => {
    const r = decodeBatch(JSON.stringify(listFixture))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const m = r.value.mutations[0]
      expect(m && "elementType" in m && m.elementType).toBe("list")
      const style = r.value.mutations[2]
      expect(style && "style" in style && style.style).toEqual({
        followTail: "true",
        itemHeight: 24,
      })
    }
  })

  test("animation batch fixture parses (Rust↔TS parity)", () => {
    const r = decodeBatch(JSON.stringify(animationFixture))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const anim = r.value.mutations[3]
      expect(anim && "target" in anim && anim.target).toEqual({
        opacity: 0.5,
        width: 300,
      })
      expect(anim && "transitionMs" in anim && anim.transitionMs).toBe(250)
    }
  })

  test("markdown batch fixture parses (Rust↔TS parity)", () => {
    const r = decodeBatch(JSON.stringify(markdownFixture))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const m = r.value.mutations[2]
      expect(m && "elementType" in m && m.elementType).toBe("markdown")
      const text = r.value.mutations[5]
      expect(text && "text" in text && text.text).toContain("# solid-gpui markdown 🎉")
      const roundTrip = decodeBatch(JSON.stringify(r.value))
      expect(roundTrip.ok).toBe(true)
    }
  })

  test("text-runs batch fixture parses and preserves Unicode segments", () => {
    const r = decodeBatch(JSON.stringify(textRunsFixture))
    expect(r.ok).toBe(true)
    if (r.ok) {
      const runs = r.value.mutations[1]
      expect(runs && "runs" in runs && runs.runs).toEqual([
        { text: "Hello ", color: "#cdd6f4", weight: 400, style: "normal" },
        { text: "世界 🌍", color: "#89b4fa", weight: 700, style: "italic", underline: true },
      ])
      expect(decodeBatch(encodeBatch(r.value))).toEqual(r)
    }
  })

  test("text-runs rejects malformed segment shapes", () => {
    for (const [field, value] of [
      ["text", ""],
      ["weight", 99],
      ["style", "slanted"],
      ["underline", "yes"],
    ] as const) {
      const r = decodeBatch(
        JSON.stringify({
          v: 1,
          seq: 1,
          mutations: [{ op: "setTextRuns", id: 1, runs: [{ text: "ok", [field]: value }] }],
        }),
      )
      expect(!r.ok && r.error.kind === "invalidShape" && r.error.path.includes(field)).toBe(true)
    }
  })

  test("setAnimation rejects keys outside the closed animatable set", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [
          { op: "setAnimation", id: 1, target: { display: "flex" }, transitionMs: 100 },
        ],
      }),
    )
    expect(!r.ok && r.error.kind === "invalidShape" && r.error.path.includes("target")).toBe(true)
  })

  test("setAnimation rejects non-numeric target values", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [
          { op: "setAnimation", id: 1, target: { width: "200px" }, transitionMs: 100 },
        ],
      }),
    )
    expect(!r.ok && r.error.kind === "invalidShape" && r.error.path.includes("target")).toBe(true)
  })

  test("setAnimation rejects unknown easing names", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [
          { op: "setAnimation", id: 1, target: { width: 300 }, transitionMs: 100, easing: "spring" },
        ],
      }),
    )
    expect(!r.ok && r.error.kind === "invalidShape" && r.error.path.includes("easing")).toBe(true)
  })

  test("unknown element type", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [{ op: "createElement", id: 1, elementType: "marquee" }],
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe("unknownElementType")
      if (r.error.kind === "unknownElementType") expect(r.error.got).toBe("marquee")
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

describe("setStyle state layer", () => {
  test("valid state decodes and round-trips; absent state stays absent", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [
          { op: "createElement", id: 1, elementType: "div" },
          { op: "setStyle", id: 1, style: { backgroundColor: "#ff0000" }, state: "hover" },
          { op: "setStyle", id: 1, style: { opacity: 1 } },
        ],
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.mutations[1]).toEqual({
        op: "setStyle",
        id: elementId(1),
        style: { backgroundColor: "#ff0000" },
        state: "hover",
      })
      expect(r.value.mutations[2]).toEqual({
        op: "setStyle",
        id: elementId(1),
        style: { opacity: 1 },
      })
      // Re-encode carries the state through.
      const enc = JSON.parse(encodeBatch(r.value))
      expect(enc.mutations[1].state).toBe("hover")
      expect(enc.mutations[2].state).toBeUndefined()
    }
  })

  test("unknown style state is a decode error (closed set)", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [{ op: "setStyle", id: 1, style: {}, state: "focusVisible" }],
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe("invalidShape")
      if (r.error.kind === "invalidShape") expect(r.error.path).toBe("mutations[0].state")
    }
  })
})

describe("tooltip fixture parity", () => {
  test("batch-tooltip-01 parses and re-encodes losslessly", () => {
    const raw = JSON.stringify(tooltipFixture)
    const r = decodeBatch(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.mutations).toContainEqual({ op: "setTooltip", id: elementId(1), tooltip: "Save this item" })
      expect(encodeBatch(r.value)).toBe(raw)
    }
  })

  test("null clears a tooltip", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 52,
        mutations: [{ op: "setTooltip", id: 1, tooltip: null }],
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.mutations[0]).toEqual({ op: "setTooltip", id: elementId(1), tooltip: null })
  })

  test("empty tooltip text is invalid", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 53,
        mutations: [{ op: "setTooltip", id: 1, tooltip: "" }],
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ kind: "invalidShape", path: "mutations[0].tooltip" })
  })

  test("missing tooltip field is invalid", () => {
    const r = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 54,
        mutations: [{ op: "setTooltip", id: 1 }],
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatchObject({ kind: "invalidShape", path: "mutations[0].tooltip" })
  })
})

describe("accessibility fixture parity", () => {
  test("batch-accessibility-01 parses and preserves typed states", () => {
    const raw = JSON.stringify(accessibilityFixture)
    const r = decodeBatch(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.mutations).toContainEqual({
        op: "setAccessibility",
        id: elementId(1),
        accessibility: { role: "combobox", expanded: true, value: "red" },
      })
      expect(encodeBatch(r.value)).toBe(raw)
    }
  })

  test("null clears accessibility and malformed states are rejected", () => {
    const cleared = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 71,
        mutations: [{ op: "setAccessibility", id: 1, accessibility: null }],
      }),
    )
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.value.mutations[0]).toEqual({ op: "setAccessibility", id: elementId(1), accessibility: null })

    const cases = [
      { accessibility: {}, path: "mutations[0].accessibility.role" },
      { accessibility: { role: "slider" }, path: "mutations[0].accessibility.role" },
      { accessibility: { role: "option", selected: "yes" }, path: "mutations[0].accessibility.selected" },
      { accessibility: { role: "option", value: 1 }, path: "mutations[0].accessibility.value" },
    ]
    for (const item of cases) {
      const r = decodeBatch(
        JSON.stringify({ v: 1, seq: 72, mutations: [{ op: "setAccessibility", id: 1, accessibility: item.accessibility }] }),
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatchObject({ kind: "invalidShape", path: item.path })
    }

    const missing = decodeBatch(
      JSON.stringify({ v: 1, seq: 73, mutations: [{ op: "setAccessibility", id: 1 }] }),
    )
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toMatchObject({ kind: "invalidShape", path: "mutations[0].accessibility" })
  })
})

describe("style-state fixture parity", () => {
  test("batch-style-state-01 parses and re-encodes losslessly", () => {
    const raw = JSON.stringify(stateFixture)
    const r = decodeBatch(raw)
    expect(r.ok).toBe(true)
    if (r.ok) expect(JSON.parse(encodeBatch(r.value))).toEqual(stateFixture)
  })
})

describe("keys fixture parity (P3)", () => {
  test("batch-keys-01 parses and re-encodes losslessly; setKeyBindings validates", () => {
    const raw = JSON.stringify(keysFixture)
    const r = decodeBatch(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(JSON.parse(encodeBatch(r.value))).toEqual(keysFixture)
      const mut = r.value.mutations[1]
      expect(mut).toMatchObject({ op: "setKeyBindings", id: 1, bindings: ["cmd-k", "ctrl-x ctrl-s"] })
    }
    // Empty-string bindings are a decode error (non-empty rule).
    const bad = decodeBatch(
      JSON.stringify({
        v: 1,
        seq: 2,
        mutations: [{ op: "setKeyBindings", id: 1, bindings: ["cmd-k", "  "] }],
      }),
    )
    expect(bad.ok).toBe(false)
  })
})

describe("scrollbar fixture parity (P6)", () => {
  test("batch-scrollbar-01 parses and re-encodes losslessly (elementType closed set)", () => {
    const raw = JSON.stringify(scrollbarFixture)
    const r = decodeBatch(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(JSON.parse(encodeBatch(r.value))).toEqual(scrollbarFixture)
      const mut = r.value.mutations[0]
      expect(mut).toMatchObject({ op: "createElement", id: 1, elementType: "scrollbar" })
    }
    // Dropping "scrollbar" from the TS closed set must be caught: a
    // re-decode of the raw line would fail.
    const again = decodeBatch(raw)
    expect(again.ok).toBe(true)
  })
})

describe("drag fixture parity (P7)", () => {
  test("batch-drag-01 parses and re-encodes losslessly (dragOver state + drop event)", () => {
    const raw = JSON.stringify(dragFixture)
    const r = decodeBatch(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(JSON.parse(encodeBatch(r.value))).toEqual(dragFixture)
      expect(r.value.mutations[1]).toMatchObject({ op: "setDragData", data: '{"itemId":42}' })
      expect(r.value.mutations[3]).toMatchObject({ state: "dragOver" })
    }
  })
})

describe("canvas fixture parity (P8)", () => {
  test("batch-canvas-01 parses and re-encodes structurally (rect/path/text items)", () => {
    const raw = JSON.stringify(canvasFixture)
    const r = decodeBatch(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(JSON.parse(encodeBatch(r.value))).toEqual(canvasFixture)
      const dl = r.value.mutations[1]
      expect(dl).toMatchObject({ op: "setDrawList", id: 1 })
      if (dl?.op === "setDrawList") {
        expect(dl.items[0]).toMatchObject({ type: "rect", w: 120, cornerRadius: 4 })
        expect(dl.items[1]).toMatchObject({ type: "path", strokeWidth: 2 })
        expect(dl.items[2]).toMatchObject({ type: "text", text: "Q3" })
      }
    }
  })

  test("decodeDrawItem rejects malformed draw items", () => {
    const bad = [
      { op: "setDrawList", id: 1, items: [{ type: "blob" }] },
      { op: "setDrawList", id: 1, items: [{ type: "path", points: [1, 2, 3], color: "#fff" }] },
      { op: "setDrawList", id: 1, items: [{ type: "text", x: 0, y: 0, size: 12, color: "#fff", text: "a\nb" }] },
      { op: "setDrawList", id: 1, items: [{ type: "rect", x: 0, y: 0, w: "10", h: 5, color: "#fff" }] },
    ]
    for (const items of bad) {
      const r = decodeBatch(JSON.stringify({ v: 1, seq: 9, mutations: [items] }))
      expect(r.ok).toBe(false)
    }
  })
})

describe("media fixture parity (P10)", () => {
  test("batch-media-01 parses and re-encodes structurally", () => {
    const raw = JSON.stringify(mediaFixture)
    const r = decodeBatch(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(JSON.parse(encodeBatch(r.value))).toEqual(mediaFixture)
      expect(r.value.mutations[4]).toMatchObject({ op: "setSrc", src: "/tmp/photo.png" })
      expect(r.value.mutations[6]).toMatchObject({ op: "setDeferred", deferred: true })
      expect(r.value.mutations[8]).toMatchObject({ op: "setAnchored", anchor: "topRight" })
    }
  })

  test("setSrc/setDeferred/setAnchored reject malformed input", () => {
    const bad = [
      { op: "setSrc", id: 1 },
      { op: "setSrc", id: 1, src: "" },
      { op: "setDeferred", id: 1, deferred: "yes" },
      { op: "setAnchored", id: 1, anchor: "middle" },
    ]
    for (const m of bad) {
      const r = decodeBatch(JSON.stringify({ v: 1, seq: 3, mutations: [m] }))
      expect(r.ok).toBe(false)
    }
    // null anchor clears — legal.
    const clear = decodeBatch(
      JSON.stringify({ v: 1, seq: 3, mutations: [{ op: "setAnchored", id: 1, anchor: null }] }),
    )
    expect(clear.ok).toBe(true)
  })
})
