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
  const [text, setText] = createSignal("")
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
    h(
      "input",
      {
        style: {
          width: 220,
          padding: 8,
          fontSize: 16,
          color: "#cdd6f4",
          backgroundColor: "#313244",
          borderRadius: 6,
        },
        placeholder: "Type here (IME/native caret)",
        value: text(),
        // P2 split: onInput fires per keystroke; onChange would only commit
        // on blur (DOM semantics).
        onInput: (e) => setText((e as { value?: string }).value ?? ""),
      },
    ),
    h("div", { style: { fontSize: 12, color: "#6c7086" } }, "solid-gpui demo — input is live"),
  )
}

if (!g.__counterHandle) {
  g.__counterHandle = await render(tree)
  // Drop the cache when this connection dies (dispose, crash, helper exit) so
  // a later --hot re-evaluation mounts FRESH instead of updating a corpse.
  // Skip if a newer mount already replaced the cached handle.
  const mounted = g.__counterHandle
  void mounted.connection.exited.then(() => {
    if (g.__counterHandle === mounted) g.__counterHandle = undefined
  })
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
    // Never hang on teardown: dispose races a hard cap, exit regardless.
    const handle = g.__counterHandle
    g.__counterHandle = undefined
    if (!handle) process.exit(0)
    void Promise.race([
      handle.dispose().catch((err) => console.error("[solid-gpui] dispose failed:", err)),
      new Promise((r) => setTimeout(r, 3000)),
    ]).then(() => process.exit(0))
  })
}

// hot-probe 1787575883
