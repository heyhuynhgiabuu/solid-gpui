import { describe, expect, test } from "bun:test"
import getStatsFixture from "../fixtures/command-get-stats.json"
import captureFrameFixture from "../fixtures/command-capture-frame.json"
import scrollToFixture from "../fixtures/command-scroll-to.json"
import getScrollOffsetFixture from "../fixtures/command-get-scroll-offset.json"
import focusElementFixture from "../fixtures/command-focus-element.json"
import { decodeCommand, encodeCommand } from "./command"

const ok = (json: string) => {
  const r = decodeCommand(json)
  if (!r.ok) throw new Error(`decode failed: ${JSON.stringify(r.error)}`)
  return r.value
}

describe("decodeCommand", () => {
  test("getStats fixture parses (Rust↔TS command parity)", () => {
    expect(ok(JSON.stringify(getStatsFixture))).toEqual({ type: "getStats", seq: 7 })
  })

  test("captureFrame fixture parses with path", () => {
    expect(ok(JSON.stringify(captureFrameFixture))).toEqual({
      type: "captureFrame",
      seq: 8,
      path: "/tmp/shot.png",
    })
  })

  test("encodeCommand emits canonical field order (fixture parity)", () => {
    expect(encodeCommand({ type: "getStats", seq: 7 })).toBe(
      JSON.stringify(getStatsFixture),
    )
    expect(
      encodeCommand({ type: "captureFrame", seq: 8, path: "/tmp/shot.png" }),
    ).toBe(JSON.stringify(captureFrameFixture))
  })

  test("scrollTo fixture parses and re-encodes exactly (parity)", () => {
    expect(ok(JSON.stringify(scrollToFixture))).toEqual({
      type: "scrollTo",
      seq: 9,
      id: 1,
      x: 0,
      y: 500,
    })
    expect(
      encodeCommand({ type: "scrollTo", seq: 9, id: 1, x: 0, y: 500 }),
    ).toBe(JSON.stringify(scrollToFixture))
  })

  test("getScrollOffset fixture parses and re-encodes exactly (parity)", () => {
    expect(ok(JSON.stringify(getScrollOffsetFixture))).toEqual({
      type: "getScrollOffset",
      seq: 10,
      id: 1,
    })
    expect(
      encodeCommand({ type: "getScrollOffset", seq: 10, id: 1 }),
    ).toBe(JSON.stringify(getScrollOffsetFixture))
  })

  test("focusElement fixture parses and re-encodes exactly (parity)", () => {
    expect(ok(JSON.stringify(focusElementFixture))).toEqual({
      type: "focusElement",
      seq: 12,
      id: 3,
    })
    expect(encodeCommand({ type: "focusElement", seq: 12, id: 3 })).toBe(
      JSON.stringify(focusElementFixture),
    )
  })

  test("scrollTo without id is invalidShape", () => {
    const r = decodeCommand(JSON.stringify({ type: "scrollTo", seq: 9, x: 0, y: 500 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })

  test("unknown command name is invalidShape (closed set)", () => {
    const r = decodeCommand(JSON.stringify({ type: "teleport", seq: 1 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })
})
