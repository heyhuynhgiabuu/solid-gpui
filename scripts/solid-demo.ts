/**
 * Solid-driven native window demo: a counter rendered by Solid reactivity,
 * drawn by GPUI. Signal updates travel as minimal setText batches.
 * Run: bun --conditions=browser run scripts/solid-demo.ts
 */
import { createSignal } from "solid-js"
import { makeH } from "../packages/solid/src/h"
import { render } from "../packages/solid/src/render"
import { createSolidRenderer } from "../packages/solid/src/renderer"
import { spawnHelper } from "../packages/client/src/index"

const connection = spawnHelper({ mode: "window" })
const { renderer, render: mount, flush } = createSolidRenderer((batch) =>
  connection.sendBatch(batch),
)
const h = makeH(renderer)

const [count, setCount] = createSignal(0)
const [pressed, setPressed] = createSignal(false)

const dispose = mount(() => {
  const label = h(
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
      "increment (no-op until events land)",
    ),
    h("div", { style: { fontSize: 12, color: "#6c7086" } }, "solid-gpui slice 5 demo"),
  )
  return label
}, renderer.createElement("#root"))

await flush()
console.log("mounted; initial ack done")

// Drive a few signal updates — each should cross as ONE setText mutation.
for (let i = 0; i < 3; i++) {
  await new Promise((r) => setTimeout(r, 1200))
  setCount((c) => c + 1)
  setPressed((p) => !p)
  await flush()
  console.log("tick", i)
}

dispose()
await flush()
await connection.close()
console.log("clean exit:", JSON.stringify(await connection.exited))
