/**
 * Counter demo — Phase 1 acceptance (`bun run example/counter`).
 *
 * Plain run: opens a native GPUI window; clicking increments via the event
 * backchannel (helper → IPC → Solid handler → auto-flush).
 *
 * Hot run (`example/counter:hot`): editing this file remounts the tree IN
 * THE SAME WINDOW via handle.update(), which reuses the whole renderer suite:
 * the element-id sequence keeps increasing (a fresh suite would collide with
 * ids live in the helper's retained tree) and event routing stays attached.
 */
import { createSignal } from "solid-js"
import { render, type RenderHandle } from "../packages/solid/src/render"

const g = globalThis as { __counterHandle?: RenderHandle; __counterWired?: boolean }

function tree(h: Parameters<RenderHandle["update"]>[0]) {
  const [count, setCount] = createSignal(0)
  const [pressed, setPressed] = createSignal(false)
  return h(
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
    h("div", { style: { fontSize: 12, color: "#6c7086" } }, "solid-gpui Phase 1 demo"),
  )
}

if (!g.__counterHandle) {
  g.__counterHandle = await render(tree)
  console.log("mounted (fresh helper)")
} else {
  await g.__counterHandle.update(tree)
  console.log("hot remounted in the SAME window")
}

// One-time wiring across all re-evaluations.
if (!g.__counterWired && g.__counterHandle) {
  g.__counterWired = true
  g.__counterHandle.connection.onEvent((ev) => {
    console.log(`event: ${ev.eventType} on #${ev.id} at (${ev.x ?? "?"}, ${ev.y ?? "?"})`)
  })
  console.log("click the button in the window; Ctrl+C here to exit")
  process.on("SIGINT", () => {
    void g.__counterHandle!.dispose().then(() => process.exit(0))
  })
}

// hot-probe 1787575883
