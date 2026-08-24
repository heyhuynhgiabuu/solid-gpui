/**
 * Temporary diagnostic probe: mounts a counter that auto-increments every
 * 1.5 s (NO clicking needed). If the on-screen number advances, the
 * mutation→retained-tree→repaint path is healthy and any click problem is
 * event-side. Auto-exits after 8 s.
 */
import { createSignal } from "solid-js"
import { render } from "../packages/solid/src/render"

const [count, setCount] = createSignal(0)

const handle = await render((h) =>
  h(
    "div",
    { style: { padding: 40, backgroundColor: "#ffffff", display: "flex" } },
    h("div", { style: { fontSize: 64, color: "#111111" } }, () => `PROBE ${count()}`),
  ),
)

console.log("probe mounted")
let i = 0
const timer = setInterval(() => {
  i += 1
  setCount(i)
  console.log(`tick ${i} -> batch flushed`)
}, 1500)

handle.connection.onEvent((ev) => console.log(`event seen: ${JSON.stringify(ev)}`))

setTimeout(() => {
  clearInterval(timer)
  void handle.dispose().then(() => {
    console.log("probe done")
    process.exit(0)
  })
}, 8000)
