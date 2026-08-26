/** Desktop command API tests (P4): wire shape + payload typing via a fake
 *  connection capturing sendCommand calls (the real ack/reply plumbing is
 *  covered by client + GUI suites). */
import { describe, expect, test } from "bun:test"
import type { SolidGpuiCommand } from "@solid-gpui/protocol"
import type { JsonValue } from "@solid-gpui/protocol"
import { appWindow, dialog, shell } from "./desktop"
import { decodeCommand } from "@solid-gpui/protocol"

type Send = (command: SolidGpuiCommand) => Promise<JsonValue>

function fakeConn(results: JsonValue[] = []): {
  conn: { sendCommand: Send }
  sent: SolidGpuiCommand[]
} {
  const sent: SolidGpuiCommand[] = []
  let i = 0
  return {
    sent,
    conn: {
      sendCommand: async (c: SolidGpuiCommand) => {
        sent.push(c)
        const r = results[i] ?? {}
        i++
        return r
      },
    },
  }
}

describe("desktop commands", () => {
  test("appWindow sends setTitle/windowAction with disjoint seq namespace", async () => {
    const { conn, sent } = fakeConn([{ applied: true }, { applied: true }])
    await appWindow.setTitle(conn, "Notes")
    await appWindow.toggleFullscreen(conn)
    expect(sent[0]).toMatchObject({ type: "setTitle", title: "Notes" })
    expect(sent[1]).toMatchObject({ type: "windowAction", action: "toggleFullscreen" })
    for (const c of sent) {
      expect(c.seq).toBeGreaterThanOrEqual(1_000_000)
    }
  })

  test("dialog.message resolves with the answer index", async () => {
    const { conn, sent } = fakeConn([{ answer: 1 }])
    const answer = await dialog.message(conn, {
      message: "Discard draft?",
      detail: "It was never saved.",
      answers: ["Cancel", "Discard"],
      level: "warning",
    })
    expect(answer).toBe(1)
    expect(sent[0]).toMatchObject({
      type: "dialogMessage",
      level: "warning",
      answers: ["Cancel", "Discard"],
    })
  })

  test("dialog.openFile/saveFile resolve paths or null on cancel", async () => {
    const a = fakeConn([{ paths: ["/tmp/a.md", "/tmp/b.md"] }])
    expect(await dialog.openFile(a.conn, { multiple: true })).toEqual(["/tmp/a.md", "/tmp/b.md"])
    const b = fakeConn([{ paths: null }])
    expect(await dialog.openFile(b.conn)).toBeNull()
    const c = fakeConn([{ path: "/tmp/notes.md" }])
    expect(await dialog.saveFile(c.conn, { suggestedName: "notes.md" })).toBe("/tmp/notes.md")
    expect(c.sent[0]).toMatchObject({ type: "dialogSaveFile", suggestedName: "notes.md" })
  })

  test("shell commands send path payloads", async () => {
    const { conn, sent } = fakeConn([{ applied: true }, { applied: true }])
    await shell.revealPath(conn, "/tmp/x")
    await shell.openWithSystem(conn, "/tmp/x.png")
    expect(sent[0]).toMatchObject({ type: "shellRevealPath", path: "/tmp/x" })
    expect(sent[1]).toMatchObject({ type: "shellOpenPath", path: "/tmp/x.png" })
  })

  test("every emitted command decodes through the protocol validator", async () => {
    // The fake captures SolidGpuiCommand objects; the wire carries JSON.
    // Round-trip each through decodeCommand to pin lockstep shape.
    const { conn, sent } = fakeConn([{ answer: 0 }, { paths: null }, { path: null }, { applied: true }, { applied: true }, { applied: true }, { applied: true }, { applied: true }])
    await dialog.message(conn, { message: "m", answers: ["ok"] })
    await dialog.openFile(conn, { directories: true })
    await dialog.saveFile(conn, { directory: "/tmp" })
    await appWindow.setTitle(conn, "t")
    await appWindow.minimize(conn)
    await appWindow.zoom(conn)
    await appWindow.activate(conn)
    await shell.revealPath(conn, "/p")
    for (const c of sent) {
      const r = decodeCommand(JSON.stringify(c))
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.type).toBe(c.type)
    }
  })
})
