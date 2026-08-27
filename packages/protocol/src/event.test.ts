import { describe, expect, test } from "bun:test"
import eventFixture from "../fixtures/event-01.json"
import keyDownFixture from "../fixtures/event-keydown-01.json"
import outsideClickFixture from "../fixtures/event-outside-click-01.json"
import { decodeEvent } from "./event"

const ok = (json: string) => {
  const r = decodeEvent(json)
  if (!r.ok) throw new Error(`decode failed: ${JSON.stringify(r.error)}`)
  return r.value
}

describe("decodeEvent", () => {
  test("outside-click fixture parses with position (Gate 3-a parity)", () => {
    expect(ok(JSON.stringify(outsideClickFixture))).toEqual({
      type: "event",
      id: 12,
      eventType: "outsideClick",
      x: 401.0,
      y: 93.0,
    })
  })

  test("fixture parses (Rust↔TS event parity)", () => {
    expect(ok(JSON.stringify(eventFixture))).toEqual({
      type: "event",
      id: 3,
      eventType: "click",
      x: 12.5,
      y: 40,
    })
  })

  test("keyDown fixture decodes key + modifiers (parity)", () => {
    expect(ok(JSON.stringify(keyDownFixture))).toEqual({
      type: "event",
      id: 5,
      eventType: "keyDown",
      key: "Enter",
      modifiers: { ctrl: false, alt: false, shift: false, cmd: false },
    })
  })

  test("bad modifiers object is invalidShape", () => {
    const r = decodeEvent(
      JSON.stringify({ type: "event", id: 5, eventType: "keyDown", key: "Enter", modifiers: { ctrl: "yes" } }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })

  test("omitted position decodes as undefined", () => {
    expect(ok(JSON.stringify({ type: "event", id: 9, eventType: "click" }))).toEqual({
      type: "event",
      id: 9,
      eventType: "click",
    })
  })

  test("change event carries the new value", () => {
    expect(
      ok(JSON.stringify({ type: "event", id: 7, eventType: "change", value: "ab" })),
    ).toEqual({ type: "event", id: 7, eventType: "change", value: "ab" })
  })

  test("submit event decodes", () => {
    expect(ok(JSON.stringify({ type: "event", id: 7, eventType: "submit" }))).toEqual({
      type: "event",
      id: 7,
      eventType: "submit",
    })
  })

  test("non-string value is invalidShape", () => {
    const r = decodeEvent(JSON.stringify({ type: "event", id: 7, eventType: "change", value: 42 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })

  test("unknown eventType is invalidShape", () => {
    const r = decodeEvent(JSON.stringify({ type: "event", id: 1, eventType: "hover" }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })

  test("wrong family tag is invalidShape (client demux relies on this)", () => {
    const r = decodeEvent(JSON.stringify({ type: "ack", seq: 1, applied: 1 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })
})

describe("input event type (P2 split)", () => {
  test("decodeEvent accepts per-edit input events", () => {
    const r = decodeEvent(
      JSON.stringify({ type: "event", id: 3, eventType: "input", value: "ab" }),
    )
    expect(r.ok).toBe(true)
    if (r.ok && r.value.type === "event") expect(r.value.eventType).toBe("input")
    else if (r.ok) throw new Error("expected an input event")
  })
})

describe("menu events (P9)", () => {
  test("menu event decodes with itemId", () => {
    const r = decodeEvent(JSON.stringify({ type: "menu", itemId: "file.open" }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.type).toBe("menu")
      if (r.value.type === "menu") expect(r.value.itemId).toBe("file.open")
    }
  })
  test("menu event rejects empty/missing itemId", () => {
    for (const bad of [{ type: "menu" }, { type: "menu", itemId: "" }]) {
      expect(decodeEvent(JSON.stringify(bad)).ok).toBe(false)
    }
  })
})
