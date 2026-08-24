import { describe, expect, test } from "bun:test"
import eventFixture from "../fixtures/event-01.json"
import keyDownFixture from "../fixtures/event-keydown-01.json"
import { decodeEvent } from "./event"

const ok = (json: string) => {
  const r = decodeEvent(json)
  if (!r.ok) throw new Error(`decode failed: ${JSON.stringify(r.error)}`)
  return r.value
}

describe("decodeEvent", () => {
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
