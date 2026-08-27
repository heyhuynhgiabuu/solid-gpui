/**
 * Gate 2 slice 2: the renderer `class` prop. A class attribute compiles into
 * the SAME base/state-layer setStyle ops hand-authored styles produce, so
 * there is no new wire surface — and because a helper-side setStyle REPLACES
 * its whole map, class + style must merge into ONE emitted base map with
 * explicit style winning. Any other shape races by batch ordering.
 */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSolidRenderer } from "./renderer"
import { spawnHelper } from "@solid-gpui/client"
import type { Mutation, MutationBatch } from "@solid-gpui/protocol"

type Renderer = ReturnType<typeof createSolidRenderer>["renderer"]
type SetStyle = Extract<Mutation, { op: "setStyle" }>

interface Recording {
  batches: MutationBatch[]
  ops: () => string[]
}

function recording(): {
  r: Recording
  R: Renderer
  flush: () => Promise<void>
} {
  const batches: MutationBatch[] = []
  let seq = 0
  const suite = createSolidRenderer(async (batch) => {
    void seq
    batches.push(batch)
    return { seq: batch.seq, applied: batch.mutations.length }
  })
  return {
    R: suite.renderer,
    flush: suite.flush,
    r: { batches, ops: () => batches.flatMap((b) => b.mutations.map((m) => m.op)) },
  }
}

/** Mountable root div. */
function div(R: Renderer): ReturnType<Renderer["createElement"]> {
  return R.createElement("div")
}

function baseStyles(r: Recording): SetStyle[] {
  return (r.batches[0]?.mutations ?? []).filter(
    (m): m is SetStyle => m.op === "setStyle" && !("state" in m),
  )
}

describe("class prop compiles into existing style ops", () => {
  test("class yields under style; every base op is a full merged map", async () => {
    const { R, r, flush } = recording()
    const el = div(R)
    R.setProp(el, "class", "p-4 flex")
    R.setProp(el, "style", { backgroundColor: "#123456", padding: 8 })
    await flush()
    // Class and style arrive as separate setProp calls, so each streams one
    // FULL merged map. The invariant is not op count but completeness: batch
    // order can never race two partial maps (setStyle REPLACES its map).
    const baseOps = baseStyles(r)
    expect(baseOps.length).toBeGreaterThanOrEqual(1)
    // Physical keys only on the wire (P1-d): the merged bag is expanded.
    expect(baseOps.at(-1)?.style).toEqual({
      display: "flex",
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
      backgroundColor: "#123456",
    })
    expect(baseOps[0]?.style).toEqual({
      display: "flex",
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    })
  })

  test("hover:/active: variants become their own state-layer ops", async () => {
    const { R, r, flush } = recording()
    const el = div(R)
    R.setProp(el, "class", "bg-red-500 hover:bg-blue-500 active:opacity-50")
    await flush()
    const mutations = (r.batches[0]?.mutations ?? []).filter(
      (m): m is SetStyle => m.op === "setStyle",
    )
    const states = mutations.map((m) => m.state)
    expect(states).toContain(undefined)
    expect(states).toContain("hover")
    expect(states).toContain("active")
    const hover = mutations.find((m) => m.state === "hover")
    expect(hover?.style).toEqual({ backgroundColor: "#3b82f6" })
  })

  test("changing the class re-emits only what changed; dropped keys disappear", async () => {
    const { R, r, flush } = recording()
    const el = div(R)
    R.setProp(el, "class", "p-4 gap-3")
    R.setProp(el, "class", "p-2")
    await flush()
    const baseStylesList = baseStyles(r).map((m) => m.style)
    // Exactly two emissions: initial p-4+gap-3, then the replacement whose
    // gap is gone (helper-side setStyle replaces, so omitting is removal).
    expect(baseStylesList).toHaveLength(2)
    expect(baseStylesList[1]).toEqual({
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
    })
  })

  test("unknown tokens warn with actionable guidance", async () => {
    const { R, r, flush } = recording()
    const el = div(R)
    const warnings: string[] = []
    const origWarn = console.warn
    console.warn = (msg?: unknown) => {
      warnings.push(String(msg))
    }
    try {
      R.setProp(el, "class", "p-4 justify-between md:hidden")
      R.setProp(el, "class", "p-4 justify-between")
    } finally {
      console.warn = origWarn
    }
    await flush()
    expect(r.ops()).toContain("setStyle")
    const mdWarnings = warnings.filter((w) => w.includes("md:hidden"))
    expect(mdWarnings.length).toBeGreaterThan(0)
    expect(mdWarnings.every((w) => w.includes("docs/tailwind-subset.md"))).toBe(true)
    const between = warnings.filter((w) => w.includes("justify-between"))
    expect(between.length).toBeGreaterThan(0)
  })

  test("className gets an explicit pointer-to-class warning and no style ops", async () => {
    const { R, r, flush } = recording()
    const el = div(R)
    const warnings: string[] = []
    const origWarn = console.warn
    console.warn = (msg?: unknown) => {
      warnings.push(String(msg))
    }
    try {
      R.setProp(el, "className", "p-4")
    } finally {
      console.warn = origWarn
    }
    await flush()
    expect(warnings.some((w) => w.includes("className") && w.includes('"class"'))).toBe(true)
    const nonCreate = (r.batches[0]?.mutations ?? []).filter((m) => m.op !== "createElement")
    expect(nonCreate).toHaveLength(0)
  })

  test("null clears class contributions with an empty replacement", async () => {
    const { R, r, flush } = recording()
    const el = div(R)
    R.setProp(el, "class", "p-4")
    R.setProp(el, "class", null)
    await flush()
    const bases = baseStyles(r)
    // Helper-side setStyle REPLACES its map: removing the sole styling source
    // must emit the EMPTY replacement (otherwise stale padding survives
    // forever). Silent omission would be a leak.
    expect(bases).toHaveLength(2)
    expect(bases.at(-1)?.style).toEqual({})
  })

  test("transitionMs animations read numeric starts from the merged map (B1/B2 through class)", async () => {
    const { R, r, flush } = recording()
    const el = div(R)
    R.setProp(el, "transitionMs", 200)
    R.setProp(el, "class", "p-2")
    R.setProp(el, "class", "p-4")
    await flush()
    const anims = (r.batches[0]?.mutations ?? []).filter(
      (m): m is Extract<Mutation, { op: "setAnimation" }> => m.op === "setAnimation",
    )
    expect(anims).toHaveLength(1)
    expect(anims[0]?.target).toEqual({
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    })
    // Companion setStyle must carry the PREVIOUS numeric start (8), not drop
    // the key — the reviewer-B1 poison without it.
    const companions = baseStyles(r)
    expect(companions.at(-1)?.style).toMatchObject({
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
    })
  })
})

describe("class prop crosses the real helper (transport, helper-gated)", () => {
  const helperPath = resolve(
    fileURLToPath(new URL("../../../target/debug/solid-gpui-helper", import.meta.url)),
  )
  test("class-compiled styles ack with an honest applied count", async () => {
    if (!existsSync(helperPath)) return console.warn("skipping: helper binary not built")
    const connection = spawnHelper({ binary: helperPath })
    const batches: MutationBatch[] = []
    const acks: { seq: number; applied: number }[] = []
    const suite = createSolidRenderer(async (batch) => {
      batches.push(batch)
      const ack = await connection.sendBatch(batch)
      acks.push(ack)
      return ack
    })
    const el = suite.renderer.createElement("div")
    suite.renderer.setProp(el, "class", "p-4 flex gap-2 bg-emerald-500 hover:bg-blue-500 rounded-lg")
    await suite.flush()
    expect(acks[0]?.applied).toBe(batches[0]?.mutations.length)
    const styleOps = (batches[0]?.mutations ?? []).filter(
      (m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle",
    )
    expect(styleOps.length).toBeGreaterThanOrEqual(2)
    await connection.close()
    expect((await connection.exited).code).toBe(0)
  })
})
