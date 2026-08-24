import { describe, expect, test } from "bun:test"
import type { SolidGpuiEvent } from "@solid-gpui/protocol"
import { spawnHelper } from "./index"

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
