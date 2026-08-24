import { createSignal, For } from "solid-js"
import { createSolidRenderer } from "./src/renderer"
const batches: any[] = []
const send = async (b: any) => { batches.push(b); return { seq: b.seq, applied: b.mutations.length } as never }
const { renderer: R, render, flush } = createSolidRenderer(send)
const container = R.createElement("#root")
const [items, setItems] = createSignal([1, 2, 3])
render(() => {
  const parent = R.createElement("div")
  R.insert(parent, () => R.createComponent(For as never, { each: items, children: () => R.createElement("div") }))
  return parent
}, container)
await flush()
console.log("MOUNT:", JSON.stringify(batches.at(-1)!.mutations.map((m) => `${m.op}:${(m as any).childId ?? (m as any).id}`)))
setItems([3, 2, 1])
await flush()
console.log("REORDER:", JSON.stringify(batches.at(-1)!.mutations.map((m) => `${m.op}:${(m as any).childId ?? (m as any).id}`)))
setItems([])
await flush()
console.log("CLEAR:", JSON.stringify(batches.at(-1)!.mutations.map((m) => m.op)))
