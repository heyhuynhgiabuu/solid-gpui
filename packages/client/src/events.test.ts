import { describe, expect, test } from "bun:test"
import type { SolidGpuiEvent } from "@solid-gpui/protocol"
import { ReplyError, spawnHelper } from "./index"

const fake = new URL("./__fixtures__/fake-helper.sh", import.meta.url).pathname

describe("event demultiplexing", () => {
  test("events arriving between batches route to onEvent", async () => {
    const events: SolidGpuiEvent[] = []
    const helper = spawnHelper({ binary: fake, args: [] })
    helper.onEvent((ev) => events.push(ev))

    // The fake emits its event line immediately; give it a beat, then close.
    await new Promise((r) => setTimeout(r, 50))
    expect(events.length).toBe(1)
    expect(events[0]).toEqual({ type: "event", id: 7, eventType: "click", x: 10, y: 20 })

    await helper.close()
    expect((await helper.exited).code).toBe(0)
  })
})

describe("sendCommand", () => {
  test("getStats resolves with the result payload (seq correlated)", async () => {
    const helper = spawnHelper({ binary: fake, args: [] })
    const value = await helper.sendCommand({ type: "getStats", seq: 1 })
    expect(value).toEqual({ frames: 3, p95Ms: 0.2 })
    await helper.close()
  })

  test("command failure (error reply) rejects sendCommand with ReplyError", async () => {
    const helper = spawnHelper({ binary: fake, args: [] })
    const err = await helper
      .sendCommand({ type: "captureFrame", seq: 2, path: "/tmp/x.png" })
      .then(
        () => null,
        (e) => e,
      )
    expect(err).toBeInstanceOf(ReplyError)
    expect((err as ReplyError).code).toBe("unsupported")
    await helper.close()
  })
})

describe("batch decode failure (seq-less error reply)", () => {
  test("sendBatch rejects with ReplyError instead of hanging forever", async () => {
    const helper = spawnHelper({ binary: fake, args: [] })
    const err = await helper
      .sendBatch({ v: 1, seq: 5, mutations: [] })
      .then(
        () => null,
        (e) => e,
      )
    expect(err).toBeInstanceOf(ReplyError)
    expect((err as ReplyError).code).toBe("decodeFailed")
    await helper.close()
  })
})
