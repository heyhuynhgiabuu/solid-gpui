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
    // The companion setStyle (the LAST one, after the mount set) REPLACES
    // the helper-side style map, so it must carry the animated keys' PREVIOUS
    // values — the numeric starts the helper's setAnimation validation reads
    // (review B1: omitting them was applyFailed -> renderer poison).
    const styles = ms.filter((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle")
    expect(styles.at(-1)?.style).toEqual({ opacity: 1, width: 200 })
    expect(styles.length).toBe(2)
    dispose()
  })

  test("key with absent or non-numeric previous value flows statically (B2)", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const dispose = render(() => {
      const box = R.createElement("div")
      R.setProp(box, "style", { opacity: 1 })
      R.setProp(box, "transitionMs", 250)
      // width appears for the first time; padding switches non-numeric ->
      // numeric. Neither has a numeric start, so neither may animate.
      R.setProp(box, "style", { opacity: 1, width: 300, padding: 8 })
      return box
    }, container)
    await flush()

    const ms = lastMutations(rec.batches)
    expect(ms.some((m) => m.op === "setAnimation")).toBe(false)
    const style = ms.filter((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle").at(-1)
    // padding is a P1-d shorthand: it expands to the four physical keys on
    // the wire, so the static style carries the expansion (not "padding").
    expect(style?.style).toEqual({
      opacity: 1,
      width: 300,
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
    })
    dispose()
  })

  test("invalid transitionMs/transitionEasing fall back instead of poisoning (B2)", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const dispose = render(() => {
      const box = R.createElement("div")
      R.setProp(box, "style", { width: 200 })
      R.setProp(box, "transitionMs", "250") // typo: not a number -> no transition
      R.setProp(box, "transitionEasing", "spring") // unknown name -> default
      R.setProp(box, "style", { width: 300 })
      return box
    }, container)
    await flush()

    const ms = lastMutations(rec.batches)
    expect(ms.some((m) => m.op === "setAnimation")).toBe(false)
    const style = ms.filter((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle").at(-1)
    expect(style?.style).toEqual({ width: 300 })
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
    // display flows statically at its new value; the animated key restates
    // its PREVIOUS value (the start), not the target.
    expect(styles.at(-1)?.style).toEqual({ display: "block", width: 200 })
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
    // Only the changed animatable key animates. The companion carries the
    // unchanged key at its current value and the animated key at its START.
    const style = ms.filter((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle").at(-1)
    expect(style?.style).toEqual({ opacity: 1, width: 200 })
    dispose()
  })
})
