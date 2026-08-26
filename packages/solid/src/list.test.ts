/** List command API tests (P5): wire shape + seq namespace via fake channel. */
import { describe, expect, test } from "bun:test"
import type { SolidGpuiCommand, JsonValue } from "@solid-gpui/protocol"
import { decodeCommand } from "@solid-gpui/protocol"
import { list } from "./list"

function fakeConn(): { conn: { sendCommand: (c: SolidGpuiCommand) => Promise<JsonValue> }; sent: SolidGpuiCommand[] } {
  const sent: SolidGpuiCommand[] = []
  return {
    sent,
    conn: { sendCommand: async (c) => { sent.push(c); return { applied: true } } },
  }
}

describe("list.scrollToItem", () => {
  test("sends a well-formed command in the 2M seq namespace", async () => {
    const { conn, sent } = fakeConn()
    await list.scrollToItem(conn, 7, 12)
    const first = sent[0]
    expect(first).toMatchObject({ type: "scrollToItem", id: 7, index: 12 })
    expect(first?.seq).toBeGreaterThanOrEqual(2_000_000)
    // Lockstep: what we sent must validate.
    const r = decodeCommand(JSON.stringify(first))
    expect(r.ok).toBe(true)
  })
})
