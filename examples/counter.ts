/**
 * Counter demo — Phase 1 acceptance (`bun run example/counter`).
 *
 * Plain run: opens a native GPUI window; clicking increments via the event
 * backchannel (helper → IPC → Solid handler → auto-flush).
 *
 * Hot run (`bun --conditions=browser --hot run examples/counter.ts`): editing
 * this file remounts the tree IN THE SAME WINDOW.
 *
 * Remount contract (why the globalThis cache holds the WHOLE suite):
 * - Reusing only the connection is unsafe: a fresh renderer restarts its id
 *   counter at 1 and collides with ids still live in the helper's retained
 *   tree. Reusing the renderer keeps one id sequence, so the remount goes
 *   through insertNode's top-swap: destroyElement(old subtree) + setRoot(new).
 */
import { createSignal } from "solid-js"
import { spawnHelper, type HelperConnection } from "../packages/client/src/index"
import { createSolidRenderer, type HostNode } from "../packages/solid/src/renderer"
import { makeH, type H } from "../packages/solid/src/h"

type Suite = ReturnType<typeof createSolidRenderer>

interface HotState {
  connection: HelperConnection
  suite: Suite
  h: H
  container: HostNode
}

const g = globalThis as { __counterHot?: HotState; __counterWired?: boolean }

function tree(h: H): HostNode {
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

if (!g.__counterHot) {
  const connection = spawnHelper({ mode: "window" })
  const suite = createSolidRenderer((batch) => connection.sendBatch(batch))
  const h = makeH(suite.renderer)
  const container = suite.renderer.createElement("#root")
  g.__counterHot = { connection, suite, h, container }
  suite.render(() => tree(h), container)
  await suite.flush()
  console.log("mounted (fresh helper)")
} else {
  // --hot re-evaluation: same window, same connection, same id sequence.
  const { suite, h, container } = g.__counterHot
  suite.render(() => tree(h), container)
  await suite.flush()
  console.log("hot remounted in the SAME window")
}

// One-time wiring across all re-evaluations.
if (!g.__counterWired && g.__counterHot) {
  g.__counterWired = true
  g.__counterHot.connection.onEvent((ev) => {
    console.log(`event: ${ev.eventType} on #${ev.id} at (${ev.x ?? "?"}, ${ev.y ?? "?"})`)
  })
  console.log("click the button in the window; Ctrl+C here to exit")
  process.on("SIGINT", () => {
    void g.__counterHot!.connection.close().then(() => process.exit(0))
  })
}

// hot-probe 1787570479
