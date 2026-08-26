/**
 * P11 styled text demo: one wrapping string with inline runs.
 *
 * The text element gets its content from `runs`; do not add string children
 * because text elements reject child attachments on the wire.
 */
import { createSignal } from "solid-js"
import { mountJsx } from "../packages/solid/src/jsx"
import type { RenderHandle } from "../packages/solid/src/render"
import type { TextRun } from "@solid-gpui/protocol"

const g = globalThis as { __textRunsHandle?: RenderHandle }

function Tree() {
  const [emphasized, setEmphasized] = createSignal(false)
  const runs = (): TextRun[] =>
    emphasized()
      ? [
          { text: "P11: ", color: "#f9e2af", weight: 700 },
          { text: "styled runs", color: "#89b4fa", weight: 700, style: "italic", underline: true },
          { text: " wrap as one string — 世界 🌍", color: "#cdd6f4" },
        ]
      : [
          { text: "P11: ", color: "#f9e2af", weight: 700 },
          { text: "styled runs", color: "#89b4fa" },
          { text: " wrap as one string — 世界 🌍", color: "#cdd6f4" },
        ]

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        width: "100%",
        height: "100%",
        padding: 24,
        backgroundColor: "#1e1e2e",
        color: "#cdd6f4",
        fontSize: 20,
      }}
    >
      <div style={{ color: "#cdd6f4", fontSize: 14 }}>P11 — span styled runs</div>
      <text runs={runs()} />
      <div
        style={{
          color: "#1e1e2e",
          backgroundColor: "#89b4fa",
          paddingX: 12,
          paddingY: 8,
          borderRadius: 6,
          cursor: "pointer",
        }}
        onClick={() => setEmphasized((value) => !value)}
      >
        toggle weight / italic / underline
      </div>
    </div>
  )
}

if (!g.__textRunsHandle) {
  g.__textRunsHandle = await mountJsx(() => <Tree />)
  const mounted = g.__textRunsHandle
  void mounted.connection.exited.then(() => {
    if (g.__textRunsHandle === mounted) g.__textRunsHandle = undefined
  })
  mounted.connection.onEvent((event) => {
    if (event.type === "event" && event.eventType === "click") {
      console.log("toggled styled runs")
    }
  })
  process.on("SIGINT", () => {
    const handle = g.__textRunsHandle
    g.__textRunsHandle = undefined
    if (!handle) process.exit(0)
    void Promise.race([
      handle.dispose().catch((error) => console.error("[solid-gpui] dispose failed:", error)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]).then(() => process.exit(0))
  })
  console.log("mounted P11 text runs — click to toggle styles; Ctrl+C to exit")
} else {
  await g.__textRunsHandle.update(() => <Tree />)
  console.log("remounted P11 text runs")
}
