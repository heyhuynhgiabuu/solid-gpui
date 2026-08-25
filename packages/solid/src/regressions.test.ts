import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { createSolidRenderer, type Send } from "./renderer"
import { makeH } from "./h"
import type { MutationBatch, Mutation } from "@solid-gpui/protocol"
import type { HostNode } from "./renderer"

function recording() {
  const batches: MutationBatch[] = []
  let seq = 0
  return {
    batches,
    send: (async (batch: MutationBatch) => {
      batches.push(batch)
      return { seq: batch.seq, applied: batch.mutations.length, _s: ++seq } as never
    }) as Send,
  }
}

const idCounts = (b: MutationBatch | undefined, op: Mutation["op"]) => {
  const counts = new Map<number, number>()
  for (const m of b?.mutations ?? []) {
    if (m.op !== op) continue
    const id = "parentId" in m ? (m as { parentId: number }).parentId : (m as { id: number }).id
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

describe("keyed/reordered list moves (review critical regression)", () => {
  test("reorder then clear emits each removeChild exactly once", async () => {
    const rec = recording()
    const { renderer: R, removeNode, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")

    // Mount [A,B,C] under parent.
    const parent = R.createElement("div")
    R.insertNode(container, parent)
    const nodes: HostNode[] = []
    for (let i = 0; i < 3; i++) {
      const n = R.createElement("div")
      R.insertNode(parent, n)
      nodes.push(n)
    }
    await flush()

    // Emulate universal's reconcileArrays MOVE branch verbatim:
    // insertNode(parent, existingNode, anchor) for nodes already in parent.
    const [a, b, c] = nodes as [HostNode, HostNode, HostNode]
    R.insertNode(parent, c, a) // move C before A
    R.insertNode(parent, b, a) // move B before A
    await flush()
    const moveOps = rec.batches.at(-1)!.mutations.map((m) => m.op)
    expect(moveOps.every((op) => op === "insertBefore")).toBe(true)

    // Clear: one removeChild per node, each exactly once (the old shadow
    // duplicated entries here, emitting invalid duplicate removeChild ops).
    for (const n of nodes) removeNode(parent, n)
    await flush()
    const removes = rec.batches.at(-1)!.mutations.filter((m) => m.op === "removeChild")
    expect(removes.length).toBe(3)
    const ids = removes.map((m) => (m as Extract<Mutation, { op: "removeChild" }>).childId)
    expect(new Set(ids).size).toBe(3)
  })
})

describe("send-failure policy (review major)", () => {
  test("failed send poisons the renderer; later flushes reject, dispose still works", async () => {
    let fail = false
    const rec = recording()
    const send: Send = async (b) => {
      if (fail) throw new Error("helper exploded")
      return rec.send(b)
    }
    const { renderer: R, render, flush } = createSolidRenderer(send)
    const container = R.createElement("#root")
    const dispose = render(() => R.createElement("div"), container)
    await flush()

    fail = true
    R.createElement("div") // queues a mutation
    await expect(flush()).rejects.toThrow(/helper exploded|poisoned/i)

    // Poisoned: subsequent flushes reject without calling send again.
    R.createElement("div")
    await expect(flush()).rejects.toThrow(/poisoned/i)

    // Dispose path still runs (its flush also rejects, but must not hang).
    await expect(flush()).rejects.toThrow()
    dispose()
  })
})

describe("remount without dispose (review minor)", () => {
  test("second mount destroys the previous root before setRoot", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")

    // First mount — NOT disposed before the second (review's leak scenario).
    const d1 = render(() => R.createElement("div"), container)
    void d1
    await flush()
    const opsBefore = rec.batches.flatMap((b) => b.mutations.map((m) => m.op)).length

    const d2 = render(() => R.createElement("div"), container)
    await flush()
    const newOps = rec.batches
      .flatMap((b) => b.mutations)
      .slice(opsBefore)
      .map((m) => m.op)
    expect(newOps).toContain("destroyElement") // old root freed, not leaked
    expect(newOps).toContain("setRoot")
    d2()
  })
})

describe("container children tracking (review minor)", () => {
  test("firstChild/nextSibling on the container return the mounted root", async () => {
    const rec = recording()
    const { renderer: R, render, firstChild, nextSibling, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const root = R.createElement("div")
    render(() => root, container)
    await flush()
    expect(firstChild(container)).toBe(root)
    expect(nextSibling(root)).toBeUndefined()
  })
})

describe("markdown via h() (S13d)", () => {
  test("function source prop re-sends setText when the signal changes", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const h = makeH(R)
    const container = R.createElement("#root")
    const [src, setSrc] = createSignal("# v1")

    const dispose = render(() => h("markdown", { source: () => src() }), container)
    await flush()
    setSrc("# v2 **updated**")
    await flush()

    const texts = rec.batches
      .flatMap((b) => b.mutations.filter((m): m is Extract<Mutation, { op: "setText" }> => m.op === "setText"))
      .map((m) => m.text)
    expect(texts).toEqual(["# v1", "# v2 **updated**"])
    dispose()
  })

  test("h() children into markdown are dropped with a warning, no wire ops", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const h = makeH(R)
    const container = R.createElement("#root")
    const warnings: string[] = []
    const origWarn = console.warn
    console.warn = (msg?: string) => { warnings.push(String(msg)) }

    try {
      const dispose = render(
        () => h("markdown", { source: "# hi" }, "stray child" as never),
        container,
      )
      await flush()
      const attachOps = rec.batches
        .flatMap((b) => b.mutations)
        .filter((m) => m.op === "appendChild" || m.op === "insertBefore")
      expect(attachOps).toEqual([])
      expect(warnings.some((w) => w.includes("markdown"))).toBe(true)
      dispose()
    } finally {
      console.warn = origWarn
    }
  })
})

describe("markdown refusal bookkeeping (review Major 2)", () => {
  test("sentinel flow: refused child then removeNode emits NO removeChild (poison path)", async () => {
    const rec = recording()
    const { renderer: R, render, flush, removeNode } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")

    // Mirror universal's sentinel flow: a text node inserted into markdown
    // (refused) and then removed unconditionally by reconcileArrays.
    const dispose = render(() => {
      const md = R.createElement("markdown")
      R.setProp(md, "source", "hi")
      const sentinel = R.createTextNode("")
      R.insertNode(md, sentinel)
      removeNode(md, sentinel)
      return md
    }, container)
    await flush()

    const ops = rec.batches.flatMap((b) => b.mutations.map((m) => m.op))
    expect(ops).not.toContain("removeChild")
    expect(ops).not.toContain("appendChild")
    expect(ops).not.toContain("insertBefore")
    dispose()
  })

  test("dispose destroys refused children (no helper-side element leak)", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")

    let sentinelId = 0
    const dispose = render(() => {
      const md = R.createElement("markdown")
      R.setProp(md, "source", "hi")
      const sentinel = R.createTextNode("stray")
      sentinelId = sentinel.id
      R.insertNode(md, sentinel)
      return md
    }, container)
    await flush()
    dispose()
    await flush()

    const destroys = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m) => m.op === "destroyElement")
    // The markdown root AND the refused-but-created sentinel are freed.
    expect(destroys.length).toBe(2)
    expect(destroys).toContainEqual(expect.objectContaining({ id: sentinelId }))
  })

  test("a node moved OUT of markdown into a div attaches normally", async () => {
    const rec = recording()
    const { renderer: R, render, flush, removeNode } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")

    let stray: ReturnType<typeof R.createElement> | undefined
    const dispose = render(() => {
      const root = R.createElement("div")
      const md = R.createElement("markdown")
      R.setProp(md, "source", "hi")
      R.insertNode(root, md)
      stray = R.createElement("div")
      R.insertNode(md, stray) // refused
      removeNode(md, stray!) // shadow-only detach
      R.insertNode(root, stray!) // legitimate wire attach
      return root
    }, container)
    await flush()

    const attaches = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m) => m.op === "appendChild" && "childId" in m && m.childId === stray!.id)
    expect(attaches.length).toBe(1)
    dispose()
  })
})

describe("markdown listener/animation guards (review Minor 3)", () => {
  test("onClick on markdown warns and emits NO setEventListener", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const warnings: string[] = []
    const orig = console.warn
    console.warn = (m?: string) => warnings.push(String(m))
    try {
      const dispose = render(() => {
        const md = R.createElement("markdown")
        R.setProp(md, "source", "hi")
        R.setProp(md, "onClick", () => {})
        return md
      }, container)
      await flush()
      const listeners = rec.batches
        .flatMap((b) => b.mutations)
        .filter((m) => m.op === "setEventListener")
      expect(listeners).toEqual([])
      expect(warnings.some((w) => w.includes("markdown"))).toBe(true)
      dispose()
    } finally {
      console.warn = orig
    }
  })

  test("transitionMs on markdown warns and emits NO setAnimation", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const warnings: string[] = []
    const orig = console.warn
    console.warn = (m?: string) => warnings.push(String(m))
    try {
      const dispose = render(() => {
        const md = R.createElement("markdown")
        R.setProp(md, "style", { fontSize: 14 })
        R.setProp(md, "transitionMs", 200)
        R.setProp(md, "style", { fontSize: 28 })
        return md
      }, container)
      await flush()
      const anims = rec.batches
        .flatMap((b) => b.mutations)
        .filter((m) => m.op === "setAnimation")
      expect(anims).toEqual([])
      expect(warnings.some((w) => w.includes("transitionMs"))).toBe(true)
      dispose()
    } finally {
      console.warn = orig
    }
  })
})
