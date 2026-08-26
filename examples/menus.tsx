/**
 * Menu bar demo (P9, macOS) — a real application menu with shortcuts.
 * Picking an item (or pressing its keystroke) fires back to JS and updates
 * the window UI; the File menu replaces itself after "Switch menu set".
 *
 * Run: bun run example/menus
 */
import { createSignal } from "solid-js"
import { mountJsx } from "../packages/solid/src/jsx"
import type { RenderHandle } from "../packages/solid/src/render"

const g = globalThis as { __menusHandle?: RenderHandle }

function Tree() {
  const [status, setStatus] = createSignal("Pick something from the menu bar")
  const [alt, setAlt] = createSignal(false)

  const item = (label: string, id: string, onPick: () => void, keystroke?: string) =>
    keystroke === undefined ? { type: "item" as const, label, id, onPick } : { type: "item" as const, label, id, onPick, keystroke }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        width: "100%",
        height: "100%",
        backgroundColor: "#1e1e2e",
      }}
    >
      <div style={{ fontSize: 15, color: "#cdd6f4" }}>{status()}</div>
      <div
        style={{
          fontSize: 13,
          color: "#a6adc8",
          paddingX: 12,
          paddingY: 6,
          borderRadius: 8,
          backgroundColor: "#313244",
        }}
        onClick={() => {
          const next = !alt()
          setAlt(next)
          void g.__menusHandle?.menus.set(
            next
              ? [
                  {
                    name: "Actions",
                    items: [
                      item("Refresh data", "data.refresh", () => setStatus("Data refreshed"), "cmd-r"),
                      { type: "separator" as const },
                      item("Switch menu set", "set.toggle", () => setStatus("switch via Actions menu")),
                    ],
                  },
                ]
              : [
                  {
                    name: "File",
                    items: [
                      item("New file", "file.new", () => setStatus("New file created"), "cmd-n"),
                      { type: "separator" as const },
                      {
                        type: "submenu" as const,
                        name: "Export",
                        items: [
                          item("Export PDF", "export.pdf", () => setStatus("Exported PDF")),
                          item("Export HTML", "export.html", () => setStatus("Exported HTML")),
                        ],
                      },
                      item("Switch menu set", "set.toggle", () => setStatus("switch via File menu")),
                    ],
                  },
                ],
          )
          setStatus("menu set swapped")
        }}
      >
        Swap the menu bar ({alt() ? "Actions" : "File"})
      </div>
    </div>
  )
}

mountJsx(() => <Tree />).then(async (handle) => {
  g.__menusHandle = handle
  await handle.menus.set([
    {
      name: "File",
      items: [
        { type: "item", label: "New file", id: "file.new", keystroke: "cmd-n", onPick: () => console.log("new file") },
        { type: "separator" },
        {
          type: "submenu",
          name: "Export",
          items: [{ type: "item", label: "PDF", id: "export.pdf", onPick: () => console.log("pdf") }],
        },
      ],
    },
    {
      name: "Edit",
      items: [
        { type: "item", label: "Cut", id: "edit.cut", osAction: "cut" },
        { type: "item", label: "Copy", id: "edit.copy", keystroke: "cmd-c", osAction: "copy" },
      ],
    },
  ])
  setTimeout(() => handle.dispose(), 15000)
})
