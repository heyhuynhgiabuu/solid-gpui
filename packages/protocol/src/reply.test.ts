import { describe, expect, test } from "bun:test"
import replyFixture from "../fixtures/reply-01.json"
import { decodeReply } from "./reply"

function ok(json: string) {
  const r = decodeReply(json)
  if (!r.ok) throw new Error(`decode failed: ${JSON.stringify(r.error)}`)
  return r.value
}

describe("decodeReply", () => {
  test("fixture ack parses (Rust↔TS reply parity)", () => {
    expect(ok(JSON.stringify(replyFixture))).toEqual({
      type: "ack",
      seq: 42,
      applied: 12,
    })
  })

  test("error reply parses", () => {
    expect(
      ok(
        JSON.stringify({
          type: "error",
          seq: null,
          code: "decodeFailed",
          message: "unknown mutation op `teleport`",
        }),
      ),
    ).toEqual({
      type: "error",
      seq: null,
      code: "decodeFailed",
      message: "unknown mutation op `teleport`",
    })
  })

  test("unknown reply type is invalidShape", () => {
    const r = decodeReply(JSON.stringify({ type: "bonk" }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })

  test("unknown error code is invalidShape", () => {
    const r = decodeReply(
      JSON.stringify({ type: "error", seq: null, code: "mystery", message: "x" }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })

  test("negative applied is invalid", () => {
    const r = decodeReply(JSON.stringify({ type: "ack", seq: 1, applied: -1 }))
    expect(r.ok).toBe(false)
  })
})

describe("decodeReply: result family", () => {
  test("result fixture parses with payload object", () => {
    const raw = JSON.stringify({ type: "result", seq: 7, value: { frames: 34, p95Ms: 0.1 } })
    const r = decodeReply(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({
        type: "result",
        seq: 7,
        value: { frames: 34, p95Ms: 0.1 },
      })
    }
  })

  test("new error codes accepted: unsupported, unknownCommand", () => {
    for (const code of ["unsupported", "unknownCommand"] as const) {
      const r = decodeReply(
        JSON.stringify({ type: "error", seq: 3, code, message: "x" }),
      )
      expect(r.ok).toBe(true)
    }
  })
})
