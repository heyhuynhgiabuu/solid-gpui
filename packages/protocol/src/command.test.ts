import { describe, expect, test } from "bun:test"
import getStatsFixture from "../fixtures/command-get-stats.json"
import captureFrameFixture from "../fixtures/command-capture-frame.json"
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

  test("unknown command name is invalidShape (closed set)", () => {
    const r = decodeCommand(JSON.stringify({ type: "teleport", seq: 1 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })
})
