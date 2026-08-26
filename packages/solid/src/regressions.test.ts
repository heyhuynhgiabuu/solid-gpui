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

describe("poisoned renderer (wire-safety slice)", () => {
  test("rejects even an empty flush after a failed batch", async () => {
    let fail = false
    const rec = recording()
    const send: Send = async (batch) => {
      if (fail) throw new Error("helper exploded")
      return rec.send(batch)
    }
    const { renderer: R, render, flush } = createSolidRenderer(send)
    const container = R.createElement("#root")
    const dispose = render(() => R.createElement("div"), container)
    await flush()

    fail = true
    R.createElement("div")
    await expect(flush()).rejects.toThrow(/helper exploded|poisoned/i)

    // The failed batch was spliced before send, so this flush has no queued
    // mutations. The poison contract still rejects it instead of silently
    // making a poisoned renderer look usable.
    await expect(flush()).rejects.toThrow(/poisoned/i)
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

    // Full final-batch op list: the stray attaches ONCE and NO invalid wire
    // op is ever emitted (a regression to the pre-fix behavior — removeChild
    // on the markdown parent — fails here even though the mock send cannot
    // validate wire ops).
    const ops = rec.batches[rec.batches.length - 1]!.mutations.map((m) => m.op)
    expect(ops).not.toContain("removeChild")
    const attaches = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m) => m.op === "appendChild" && "childId" in m && m.childId === stray!.id)
    expect(attaches.length).toBe(1)
    dispose()
  })
})

describe("cross-flush detach/reattach (wire-safety slice)", () => {
  const opsOf = (b: MutationBatch | undefined) => (b ? b.mutations.map((m) => m.op) : [])

  test("detach in one flush, reattach in a LATER flush reuses the same node", async () => {
    const rec = recording()
    const { renderer: R, render, flush, removeNode, firstChild } =
      createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let parent: HostNode | undefined, child: HostNode | undefined
    const dispose = render(() => {
      parent = R.createElement("div")
      child = R.createElement("div")
      R.insertNode(parent, child)
      return parent
    }, container)
    await flush()
    const childId = child!.id
    const createCount = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m) => m.op === "createElement").length

    // Detach in flush N.
    removeNode(parent!, child!)
    await flush()
    expect(opsOf(rec.batches.at(-1))).toEqual(["removeChild"])

    // A later microtask passes before the reattach (the upstream hazard was
    // drop-in-one-flush, re-create-in-another).
    await Promise.resolve()

    // Reattach in flush N+1: the SAME node object with the SAME id must come
    // back — no createElement, no destroyElement (an upstream-style
    // drop-on-detach renderer would destroy here and re-create on reattach).
    R.insertNode(parent!, child!)
    await flush()
    expect(opsOf(rec.batches.at(-1))).toEqual(["appendChild"])
    expect(child!.id).toBe(childId)
    const laterCreates = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m) => m.op === "createElement" || m.op === "destroyElement")
    expect(laterCreates.length).toBe(createCount) // only the original creates
    expect(firstChild(parent!)).toBe(child!)
    dispose()
  })

  test("detach from one parent, attach to another in a later flush (cross-parent move)", async () => {
    const rec = recording()
    const { renderer: R, render, flush, removeNode } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let root: HostNode | undefined, p: HostNode | undefined, q: HostNode | undefined, c: HostNode | undefined
    const dispose = render(() => {
      root = R.createElement("div")
      p = R.createElement("div")
      q = R.createElement("div")
      R.insertNode(root, p)
      R.insertNode(root, q)
      c = R.createElement("div")
      R.insertNode(p, c)
      return root
    }, container)
    await flush()
    const cid = c!.id

    removeNode(p!, c!)
    await flush()
    expect(opsOf(rec.batches.at(-1))).toEqual(["removeChild"])

    await Promise.resolve()

    R.insertNode(q!, c!)
    await flush()
    const last = rec.batches.at(-1)!
    expect(opsOf(last)).toEqual(["appendChild"])
    const op = last.mutations[0] as Extract<Mutation, { op: "appendChild" }>
    // Wire ids are branded ElementId; compare numerically like the existing
    // parentId/childId casts in this file.
    expect(op.parentId as unknown as number).toBe(q!.id)
    expect(op.childId as unknown as number).toBe(c!.id)
    expect(c!.id).toBe(cid) // identity survives the cross-parent move
    const destroys = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m) => m.op === "destroyElement")
    expect(destroys).toEqual([])
    dispose()
  })

  test("keyed reorder across separate flushes emits only insertBefore, identity preserved", async () => {
    const rec = recording()
    const { renderer: R, render, flush, firstChild, nextSibling } =
      createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let parent: HostNode | undefined, a: HostNode | undefined, b: HostNode | undefined, c: HostNode | undefined
    const dispose = render(() => {
      parent = R.createElement("div")
      a = R.createElement("div")
      b = R.createElement("div")
      c = R.createElement("div")
      R.insertNode(parent, a)
      R.insertNode(parent, b)
      R.insertNode(parent, c)
      return parent
    }, container)
    await flush()
    const ids = [a!.id, b!.id, c!.id]

    // universal's reconcileArrays keyed-move branch, spread across separate
    // flushes: insertNode(parent, existingNode, anchor) per move.
    R.insertNode(parent!, c!, a!)
    await flush()
    expect(opsOf(rec.batches.at(-1))).toEqual(["insertBefore"])

    await Promise.resolve()

    R.insertNode(parent!, b!, a!)
    await flush()
    expect(opsOf(rec.batches.at(-1))).toEqual(["insertBefore"])

    // Shadow order after [A,B,C] → C before A → B before A: [C,B,A].
    const order = [
      firstChild(parent!)!.id,
      nextSibling(firstChild(parent!)!)!.id,
      nextSibling(nextSibling(firstChild(parent!)!)!)!.id,
    ]
    expect(order).toEqual([c!.id, b!.id, a!.id])
    expect([a!.id, b!.id, c!.id]).toEqual(ids) // no re-created nodes
    const postMountCreates = rec.batches
      .slice(1)
      .flatMap((b) => b.mutations)
      .filter((m) => m.op === "createElement" || m.op === "destroyElement")
    expect(postMountCreates).toEqual([])
    dispose()
  })

  test("detach does NOT drop the element: listener wiring survives reattach", async () => {
    const rec = recording()
    const { renderer: R, render, flush, removeNode, handler } =
      createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const fn = () => {}
    let parent: HostNode | undefined, child: HostNode | undefined
    const dispose = render(() => {
      parent = R.createElement("div")
      child = R.createElement("div")
      R.setProp(child, "onClick", fn)
      R.insertNode(parent, child)
      return parent
    }, container)
    await flush()
    expect(handler(child!.id, "click")).toBe(fn)

    removeNode(parent!, child!)
    await flush()
    // The wire said removeChild; the element must stay alive and wired
    // (a drop-on-detach renderer would have cleared the registry here).
    expect(handler(child!.id, "click")).toBe(fn)

    await Promise.resolve()

    R.insertNode(parent!, child!)
    await flush()
    // Reattach needs no re-registration: the same listener answers.
    expect(handler(child!.id, "click")).toBe(fn)
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
