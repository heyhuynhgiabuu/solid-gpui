import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { createSolidRenderer, type Send } from "./renderer"
import type { MutationBatch, Mutation } from "@solid-gpui/protocol"

function recording(): { send: Send; batches: MutationBatch[] } {
  const batches: MutationBatch[] = []
  let seq = 0
  return {
    batches,
    send: async (batch) => {
      batches.push(batch)
      const ours = ++seq
      return { seq: batch.seq, applied: batch.mutations.length, _ours: ours } as never
    },
  }
}

const ops = (b: MutationBatch | undefined) => (b ? b.mutations.map((m) => m.op) : [])
const findTextSet = (b: MutationBatch | undefined) =>
  b?.mutations.filter((m): m is Extract<Mutation, { op: "setText" }> => m.op === "setText")

describe("mount", () => {
  test("renders a component tree to an exact mutation sequence", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")

    const dispose = render(() => {
      const root = R.createElement("div")
      R.setProp(root, "style", { display: "flex", flexDirection: "column", gap: 8 })
      const label = R.createTextNode("hello")
      R.insertNode(root, label)
      const box = R.createElement("div")
      R.insertNode(root, box)
      R.setProp(box, "onClick", () => {})
      return root
    }, container)
    await flush()

    expect(rec.batches.length).toBe(1)
    const m = rec.batches[0]!.mutations
    expect(ops(rec.batches[0])).toEqual([
      "createElement", // root div
      "setStyle",
      "createElement", // text node
      "setText",
      "appendChild",
      "createElement", // box div
      "appendChild",
      "setEventListener",
      "setRoot",
    ])
    const style = m[1] as Extract<Mutation, { op: "setStyle" }>
    expect(style.style).toEqual({ display: "flex", flexDirection: "column", gap: 8 })
    const listener = m[7] as Extract<Mutation, { op: "setEventListener" }>
    expect(listener.eventType).toBe("click")
    expect(listener.enabled).toBe(true)
    // setRoot targets the div, not the container sentinel
    const setRoot = m[8] as Extract<Mutation, { op: "setRoot" }>
    expect(setRoot.id).toBeGreaterThan(0)
    dispose()
    await flush()
  })
})

describe("fine-grained updates", () => {
  test("a signal change sends ONLY the affected setText", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const [count, setCount] = createSignal(0)

    render(() => {
      const root = R.createElement("div")
      R.insert(root, () => `Count: ${count()}`)
      return root
    }, container)
    await flush()
    expect(rec.batches.length).toBe(1)

    setCount(1)
    await flush()
    expect(rec.batches.length).toBe(2)
    expect(ops(rec.batches[1])).toEqual(["setText"])
    const sets = findTextSet(rec.batches[1])
    expect(sets?.[0]?.text).toBe("Count: 1")
  })

  test("style prop change sends only setStyle", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null

    render(() => {
      const root = R.createElement("div")
      node = root
      return root
    }, container)
    await flush()

    R.setProp(node!, "style", { opacity: 1 })
    await flush()
    expect(ops(rec.batches[1])).toEqual(["setStyle"])

    R.setProp(node!, "style", { opacity: 0 })
    await flush()
    expect(ops(rec.batches[2])).toEqual(["setStyle"])
  })
})

describe("lifecycle", () => {
  test("dispose destroys the mounted root (window clears)", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")

    const dispose = render(() => R.createElement("div"), container)
    await flush()
    dispose()
    await flush()

    // Top-level dispose: the root element is destroyed; helper semantics
    // clear the window (destroying the root clears it). No container-level
    // removeChild exists — the container is virtual.
    const last = ops(rec.batches.at(-1))
    expect(last).toContain("destroyElement")
    expect(last).not.toContain("setRoot")
  })

  test("flush with empty queue is a no-op (no empty batches)", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    await flush()
    await flush()
    expect(rec.batches.length).toBe(0)
  })
})
