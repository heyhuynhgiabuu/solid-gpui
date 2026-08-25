import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { createSolidRenderer, type Send } from "./renderer"
import type { MutationBatch, Mutation } from "@solid-gpui/protocol"

function recording(): { send: Send; batches: MutationBatch[] } {
  const batches: MutationBatch[] = []
  return {
    batches,
    send: async (batch) => {
      batches.push(batch)
      return { seq: batch.seq, applied: batch.mutations.length } as never
    },
  }
}

const lastMutations = (batches: MutationBatch[]): readonly Mutation[] =>
  batches.at(-1)?.mutations ?? []

describe("transition props animate style changes", () => {
  test("changed animatable keys go out as setAnimation, not an instant setStyle snap", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const dispose = render(() => {
      const box = R.createElement("div")
      R.setProp(box, "style", { opacity: 1, width: 200 })
      R.setProp(box, "transitionMs", 250)
      R.setProp(box, "style", { opacity: 0, width: 300 })
      return box
    }, container)
    await flush()

    const ms = lastMutations(rec.batches)
    const anim = ms.find((m) => m.op === "setAnimation")
    expect(anim).toMatchObject({
      op: "setAnimation",
      target: { opacity: 0, width: 300 },
      transitionMs: 250,
    })
    // The companion setStyle (the LAST one, after the mount set) must NOT
    // carry the animated keys (it would snap them to the target instantly,
    // defeating the animation).
    const styles = ms.filter((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle")
    expect(styles.at(-1)?.style).toEqual({})
    expect(styles.length).toBe(2)
    dispose()
  })

  test("style change without transitionMs stays a plain setStyle", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const dispose = render(() => {
      const box = R.createElement("div")
      R.setProp(box, "style", { width: 200 })
      R.setProp(box, "style", { width: 300 })
      return box
    }, container)
    await flush()

    const ms = lastMutations(rec.batches)
    expect(ms.some((m) => m.op === "setAnimation")).toBe(false)
    expect(ms.filter((m) => m.op === "setStyle").length).toBeGreaterThan(0)
    dispose()
  })

  test("non-animatable or non-numeric changes stay in the static setStyle", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const dispose = render(() => {
      const box = R.createElement("div")
      R.setProp(box, "style", { display: "flex", width: 200 })
      R.setProp(box, "transitionMs", 250)
      R.setProp(box, "style", { display: "block", width: 300 })
      return box
    }, container)
    await flush()

    const ms = lastMutations(rec.batches)
    const anim = ms.find((m): m is Extract<Mutation, { op: "setAnimation" }> => m.op === "setAnimation")
    expect(anim?.target).toEqual({ width: 300 })
    const styles = ms.filter((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle")
    // display flows statically; width excluded (animated).
    expect(styles.at(-1)?.style).toEqual({ display: "block" })
    dispose()
  })
})

describe("h() reactive style prop", () => {
  test("function style re-flows on signal change: flip emits setAnimation", async () => {
    const { makeH } = await import("./h")
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const h = makeH(R)
    const container = R.createElement("#root")
    const [open, setOpen] = createSignal(false)
    const dispose = render(
      () =>
        h(
          "div",
          {
            // Function style = reactive bag (compiled-JSX getter semantics):
            // re-evaluated inside a render effect whenever its signals change.
            style: () => ({ opacity: 1, width: open() ? 300 : 200 }),
            transitionMs: 250,
          },
          "box",
        ),
      container,
    )
    await flush()
    const mountOps = rec.batches[0]!.mutations.map((m) => m.op)
    expect(mountOps).toContain("setStyle")

    setOpen(true)
    await flush()
    const ms = lastMutations(rec.batches)
    const anim = ms.find((m): m is Extract<Mutation, { op: "setAnimation" }> => m.op === "setAnimation")
    expect(anim).toMatchObject({
      op: "setAnimation",
      target: { width: 300 },
      transitionMs: 250,
    })
    // Only the changed animatable key animates; opacity is unchanged and
    // stays in the static companion.
    const style = ms.filter((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle").at(-1)
    expect(style?.style).toEqual({ opacity: 1 })
    dispose()
  })
})
