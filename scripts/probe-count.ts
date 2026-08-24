/**
 * Temporary diagnostic probe: auto-incrementing counter using the SAME wiring
 * as examples/counter.ts (direct createSolidRenderer + sendBatch), plus ack
 * logging so we can see what the helper claims to apply per batch.
 * Auto-exits after 8 s. NO clicking needed.
 */
import { createSignal } from "solid-js"
import { spawnHelper } from "../packages/client/src/index"
import { createSolidRenderer } from "../packages/solid/src/renderer"
import { makeH } from "../packages/solid/src/h"

const [count, setCount] = createSignal(0)
const [bg, setBg] = createSignal("#ff3b30")
const COLORS = ["#ff3b30", "#34c759", "#007aff", "#ffcc00", "#af52de"]
const connection = spawnHelper({ mode: "window" })
const suite = createSolidRenderer(async (batch) => {
  const ack = await connection.sendBatch(batch)
  console.log(
    `ack seq=${ack.seq} applied=${ack.applied}/${batch.mutations.length}` +
      ` [${batch.mutations.map((m) => m.op).join(",")}]`,
  )
  return ack
})
const h = makeH(suite.renderer)
const container = suite.renderer.createElement("#root")
suite.render(
  () =>
    h(
      "div",
      { style: { padding: 40, backgroundColor: bg(), display: "flex" } },
      h("div", { style: { fontSize: 96, color: "#111111" } }, () => `PROBE ${count()}`),
    ),
  container,
)
await suite.flush()
console.log("probe mounted")

let i = 0
const timer = setInterval(() => {
  i += 1
  console.log(`-- tick ${i}`)
  setCount(i)
  setBg(COLORS[i % COLORS.length])
  void suite.flush()
}, 1500)

setTimeout(() => {
  clearInterval(timer)
  void connection.close().then(() => process.exit(0))
}, 8000)
