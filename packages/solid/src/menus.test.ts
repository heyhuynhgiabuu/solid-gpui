import { describe, expect, test } from "bun:test"
import { createMenus, type MenuItemInput } from "./menus"
import type { SolidGpuiCommand, JsonValue } from "@solid-gpui/protocol"

function fakeChannel() {
  const sent: SolidGpuiCommand[] = []
  return {
    sent,
    sendCommand(command: SolidGpuiCommand): Promise<JsonValue> {
      sent.push(command)
      return Promise.resolve({ applied: true })
    },
  }
}

describe("menus (P9)", () => {
  test("set strips callbacks, sends wire spec; picks route by id", async () => {
    const channel = fakeChannel()
    const menus = createMenus(channel)
    let picked = ""
    await menus.set([
      {
        name: "File",
        items: [
          { type: "item", label: "Open…", id: "file.open", keystroke: "cmd-o", onPick: () => (picked = "open") },
          { type: "separator" },
          {
            type: "submenu",
            name: "Export",
            items: [{ type: "item", label: "PDF", id: "export.pdf", onPick: () => (picked = "pdf") }],
          },
        ],
      },
    ])
    expect(channel.sent.length).toBe(1)
    const cmd = channel.sent[0]
    if (cmd !== undefined && cmd.type === "setMenus") {
      // Callbacks must NOT ride the wire.
      expect(JSON.stringify(cmd)).not.toContain("onPick")
      const first = cmd.menus[0]?.items[0]
      expect(first).toMatchObject({ type: "item", label: "Open…", id: "file.open", keystroke: "cmd-o" })
    } else {
      throw new Error("expected setMenus")
    }

    expect(menus.handleEvent({ type: "menu", itemId: "file.open" })).toBe(true)
    expect(picked).toBe("open")
    expect(menus.handleEvent({ type: "menu", itemId: "export.pdf" })).toBe(true)
    expect(picked).toBe("pdf")
    // Unknown id consumes but warns.
    expect(menus.has("nope")).toBe(false)
    expect(menus.handleEvent({ type: "menu", itemId: "nope" })).toBe(true)
  })

  test("set replaces the registry atomically; non-menu events pass through", async () => {
    const channel = fakeChannel()
    const menus = createMenus(channel)
    let hits = 0
    await menus.set([{ name: "A", items: [{ type: "item", label: "X", id: "a.x", onPick: () => hits++ }] }])
    await menus.set([{ name: "B", items: [{ type: "separator" }] }])
    expect(menus.has("a.x")).toBe(false)
    expect(menus.handleEvent({ type: "event", itemId: undefined })).toBe(false)
    expect(hits).toBe(0)
  })
})
