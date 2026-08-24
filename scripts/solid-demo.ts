/**
 * Solid-driven native window demo: a counter rendered by Solid reactivity,
 * drawn by GPUI. Clicks cross back over IPC as events; handlers run and the
 * resulting mutations flush automatically.
 * Run: bun --conditions=browser run scripts/solid-demo.ts
 */
import { createSignal } from "solid-js"
import { render } from "../packages/solid/src/render"

const [count, setCount] = createSignal(0)
const [pressed, setPressed] = createSignal(false)

const handle = await render((h) =>
  h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        width: "100%",
        height: "100%",
        backgroundColor: "#1e1e2e",
      },
    },
    h("div", { style: { fontSize: 28, color: "#cdd6f4" } }, () => `Count: ${count()}`),
    h(
      "div",
      {
        style: {
          padding: "10px 18px",
          borderRadius: 8,
          backgroundColor: pressed() ? "#89b4fa" : "#45475a",
          color: "#1e1e2e",
          cursor: "pointer",
        },
        onClick: () => setCount((c) => c + 1),
      },
      "increment (click me — events work!)",
    ),
    h("div", { style: { fontSize: 12, color: "#6c7086" } }, "solid-gpui slice 6 demo"),
  ),
)

console.log("mounted; initial ack done")

// Visibility into the wire: every click arrives as an async event line.
handle.connection.onEvent((ev) => {
  console.log(`event: ${ev.eventType} on #${ev.id} at (${ev.x ?? "?"}, ${ev.y ?? "?"})`)
})
console.log("click the button in the window; Ctrl+C here to exit")

await new Promise<void>((resolve) => {
  process.on("SIGINT", () => resolve())
})

await handle.dispose()
console.log("clean exit:", JSON.stringify(await handle.connection.exited))
