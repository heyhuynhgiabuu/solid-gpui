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

describe("input/textarea", () => {
  test("input tag maps to elementType input and value to setValue", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const dispose = render(() => {
      const root = R.createElement("div")
      const input = R.createElement("input")
      R.setProp(input, "value", "hi")
      R.insertNode(root, input)
      return root
    }, container)
    await flush()

    const m = rec.batches[0]!.mutations
    const creates = m.filter(
      (x): x is Extract<Mutation, { op: "createElement" }> => x.op === "createElement",
    )
    expect(creates[creates.length - 1]?.elementType).toBe("input")
    const sv = m.find((x) => x.op === "setValue") as Extract<Mutation, { op: "setValue" }> | undefined
    expect(sv?.value).toBe("hi")
    dispose()
    await flush()
  })

  test("textarea tag maps to elementType textarea", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const dispose = render(() => {
      const root = R.createElement("div")
      const ta = R.createElement("textarea")
      R.insertNode(root, ta)
      return root
    }, container)
    await flush()
    const m = rec.batches[0]!.mutations
    const creates = m.filter(
      (x): x is Extract<Mutation, { op: "createElement" }> => x.op === "createElement",
    )
    expect(creates[creates.length - 1]?.elementType).toBe("textarea")
    dispose()
    await flush()
  })

  test("onChange registers the change event listener", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const dispose = render(() => {
      const root = R.createElement("div")
      const input = R.createElement("input")
      R.setProp(input, "onChange", () => {})
      R.insertNode(root, input)
      return root
    }, container)
    await flush()
    const m = rec.batches[0]!.mutations
    const ev = m.find((x) => x.op === "setEventListener") as
      | Extract<Mutation, { op: "setEventListener" }>
      | undefined
    expect(ev?.eventType).toBe("change")
    expect(ev?.enabled).toBe(true)
    dispose()
    await flush()
  })

  test("placeholder and minRows flow as single-key style maps", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    const dispose = render(() => {
      const root = R.createElement("div")
      const ta = R.createElement("textarea")
      R.setProp(ta, "placeholder", "Type here")
      R.setProp(ta, "minRows", 2)
      R.insertNode(root, ta)
      return root
    }, container)
    await flush()
    const styles = rec.batches[0]!.mutations.filter((x) => x.op === "setStyle") as Extract<
      Mutation,
      { op: "setStyle" }
    >[]
    expect(styles).toEqual([
      { op: "setStyle", id: styles[0]!.id, style: { placeholder: "Type here" } },
      { op: "setStyle", id: styles[1]!.id, style: { minRows: 2 } },
    ])
    dispose()
    await flush()
  })
})

describe("markdown element (S13d)", () => {
  test("markdown tag creates a markdown element; source prop emits setText", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")

    const dispose = render(() => {
      const root = R.createElement("div")
      const md = R.createElement("markdown")
      R.insertNode(root, md)
      R.setProp(md, "source", "# Title\n\n**bold**")
      return root
    }, container)
    await flush()

    const m = rec.batches[0]!.mutations
    const create = m.find((x) => x.op === "createElement" && "elementType" in x && x.elementType === "markdown")
    expect(create).toBeDefined()
    const sets = findTextSet(rec.batches[0])
    expect(sets?.length).toBe(1)
    expect(sets?.[0]?.text).toBe("# Title\n\n**bold**")
    dispose()
  })

  test("children of a markdown element are refused client-side (helper rejects attach)", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")

    const dispose = render(() => {
      const md = R.createElement("markdown")
      R.setProp(md, "source", "hi")
      const stray = R.createTextNode("extra")
      R.insertNode(md, stray)
      return md
    }, container)
    await flush()

    // No appendChild may be emitted for a markdown parent — the helper
    // rejects the attach (applyFailed poisons the session).
    const bad = rec.batches[0]!.mutations.filter(
      (x) => x.op === "appendChild" || x.op === "insertBefore",
    )
    expect(bad).toEqual([])
    dispose()
  })

  test("markdown source updates via setProp emit a new setText", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let md!: ReturnType<typeof R.createElement>
    const dispose = render(() => {
      md = R.createElement("markdown")
      R.setProp(md, "source", "# v1")
      return md
    }, container)
    await flush()
    // Direct setProp updates re-send (the reactive path wraps this via a
    // function `source` prop in makeH — see regressions.test.ts).
    R.setProp(md, "source", "# v2")
    await flush()

    const texts = rec.batches.flatMap((b) => findTextSet(b) ?? [])
    expect(texts.map((t) => t.text)).toEqual(["# v1", "# v2"])
    dispose()
  })
})

describe("state-layer styles (hoverStyle/activeStyle)", () => {
  test("setProperty routes hoverStyle/activeStyle to state-layered setStyle", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      node = root
      return root
    }, container)
    await flush()

    R.setProp(node!, "style", { backgroundColor: "#45475a", borderRadius: 8 })
    R.setProp(node!, "hoverStyle", { backgroundColor: "#89b4fa" })
    R.setProp(node!, "activeStyle", { backgroundColor: "rgba(137, 180, 250, 0.5)" })
    await flush()
    dispose()

    const styles = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle")
    const base = styles.find((m) => m.state === undefined)
    const hover = styles.find((m) => m.state === "hover")
    const active = styles.find((m) => m.state === "active")
    expect(base?.style).toEqual({ backgroundColor: "#45475a", borderRadius: 8 })
    expect(hover?.style).toEqual({ backgroundColor: "#89b4fa" })
    expect(active?.style).toEqual({ backgroundColor: "rgba(137, 180, 250, 0.5)" })
    // Exactly three layers: base + hover + active, no duplicates.
    expect(styles.length).toBe(3)
  })

  test("markdown refuses state layers (validation/rendering agree; emitting would poison)", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const md = R.createElement("markdown")
      node = md
      return md
    }, container)
    await flush()

    R.setProp(node!, "source", "# hi")
    R.setProp(node!, "hoverStyle", { backgroundColor: "#ff0000" })
    await flush()
    dispose()

    const stateStyles = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle" && m.state !== undefined)
    expect(stateStyles).toEqual([])
  })
})

describe("shorthand normalization (P1-d)", () => {
  test("paddingX/paddingY/margin/inset/size expand to physical keys", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      node = root
      return root
    }, container)
    await flush()

    R.setProp(node!, "style", {
      paddingX: 12,
      paddingY: 6,
      margin: 8,
      inset: 4,
      size: 100,
      boxShadow: "0 2 8 #00000060",
    })
    await flush()
    dispose()

    const style = rec.batches
      .flatMap((b) => b.mutations)
      .find((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle")
    expect(style?.style).toEqual({
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 6,
      paddingBottom: 6,
      marginTop: 8,
      marginRight: 8,
      marginBottom: 8,
      marginLeft: 8,
      top: 4,
      right: 4,
      bottom: 4,
      left: 4,
      width: 100,
      height: 100,
      boxShadow: "0 2 8 #00000060",
    })
  })

  test("physical keys pass through untouched (no double expansion)", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      node = root
      return root
    }, container)
    await flush()

    R.setProp(node!, "style", { paddingLeft: 3, marginTop: 5, width: 42 })
    await flush()
    dispose()

    const style = rec.batches
      .flatMap((b) => b.mutations)
      .find((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle")
    expect(style?.style).toEqual({ paddingLeft: 3, marginTop: 5, width: 42 })
  })

  test("state layers expand too (hoverStyle with paddingX)", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      node = root
      return root
    }, container)
    await flush()

    R.setProp(node!, "hoverStyle", { paddingX: 2 })
    await flush()
    dispose()

    const hover = rec.batches
      .flatMap((b) => b.mutations)
      .find((m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle" && m.state === "hover")
    expect(hover?.style).toEqual({ paddingLeft: 2, paddingRight: 2 })
  })
})

describe("onInput/onChange split (P2 G1)", () => {
  test("onInput registers the per-edit input listener; onChange stays change", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const input = R.createElement("input")
      node = input
      return input
    }, container)
    await flush()

    R.setProp(node!, "onInput", () => {})
    R.setProp(node!, "onChange", () => {})
    await flush()
    dispose()

    const listeners = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m): m is Extract<Mutation, { op: "setEventListener" }> => m.op === "setEventListener")
      .map((m) => m.eventType)
    expect(listeners).toContain("input")
    expect(listeners).toContain("change")
    // DOM contract documented: input fires per edit, change commits on blur.
  })
})

describe("keys prop (P3)", () => {
  test("keys map installs bindings + keys listener; events dispatch per binding", async () => {
    const rec = recording()
    const { renderer: R, render, flush, handler } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null
    const fired: string[] = []
    const dispose = render(() => {
      const root = R.createElement("div")
      node = root
      return root
    }, container)
    await flush()

    R.setProp(node!, "keys", {
      "cmd-k": () => fired.push("cmd-k"),
      "ctrl-x ctrl-s": () => fired.push("ctrl-x ctrl-s"),
    })
    await flush()

    const muts = rec.batches.flatMap((b) => b.mutations)
    const kb = muts.find((m): m is Extract<Mutation, { op: "setKeyBindings" }> => m.op === "setKeyBindings")
    expect(kb?.bindings).toEqual(["cmd-k", "ctrl-x ctrl-s"])
    expect(
      muts.some(
        (m): m is Extract<Mutation, { op: "setEventListener" }> =>
          m.op === "setEventListener" && m.eventType === "keys" && m.enabled,
      ),
    ).toBe(true)

    // Event routing: the helper reports the fired binding in `key`.
    const dispatch = handler((node as unknown as { id: number }).id, "keys")
    expect(typeof dispatch).toBe("function")
    dispatch?.({ type: "event", id: 1, eventType: "keys", x: null, y: null, key: "cmd-k", modifiers: null, value: null } as never)
    dispatch?.({ type: "event", id: 1, eventType: "keys", x: null, y: null, key: "ctrl-x ctrl-s", modifiers: null, value: null } as never)
    expect(fired).toEqual(["cmd-k", "ctrl-x ctrl-s"])
    dispose()
  })

  test("clearing keys removes bindings and the listener", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      node = root
      return root
    }, container)
    await flush()

    R.setProp(node!, "keys", { escape: () => {} })
    R.setProp(node!, "keys", undefined)
    await flush()
    dispose()

    const muts = rec.batches.flatMap((b) => b.mutations)
    const kb = muts.filter((m): m is Extract<Mutation, { op: "setKeyBindings" }> => m.op === "setKeyBindings")
    expect(kb[kb.length - 1]?.bindings).toEqual([])
    expect(
      muts.some(
        (m): m is Extract<Mutation, { op: "setEventListener" }> =>
          m.op === "setEventListener" && m.eventType === "keys" && !m.enabled,
      ),
    ).toBe(true)
  })
})

describe("drag & drop (P7)", () => {
  test("dragData stringifies to the wire; onDragStart/onDrop register listeners", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null
    let target: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      node = R.createElement("div")
      target = R.createElement("div")
      R.insert(root, node, null, null)
      R.insert(root, target, null, null)
      return root
    }, container)
    await flush()

    R.setProp(node!, "dragData", { itemId: 42 })
    R.setProp(node!, "onDragStart", () => {})
    R.setProp(target!, "onDrop", () => {})
    R.setProp(target!, "dragOverStyle", { backgroundColor: "#7aa2f7" })
    await flush()
    dispose()

    const muts = rec.batches.flatMap((b) => b.mutations)
    const dd = muts.find((m): m is Extract<Mutation, { op: "setDragData" }> => m.op === "setDragData")
    expect(dd?.data).toBe('{"itemId":42}')
    const listeners = muts
      .filter((m): m is Extract<Mutation, { op: "setEventListener" }> => m.op === "setEventListener")
      .map((m) => `${m.eventType}:${m.enabled}`)
    expect(listeners).toContain("dragStart:true")
    expect(listeners).toContain("drop:true")
    const over = muts.find(
      (m): m is Extract<Mutation, { op: "setStyle" }> => m.op === "setStyle" && m.state === "dragOver",
    )
    expect(over?.style).toEqual({ backgroundColor: "#7aa2f7" })
  })

  test("clearing dragData sends the empty string", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let node: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      node = root
      return root
    }, container)
    await flush()
    R.setProp(node!, "dragData", "x")
    R.setProp(node!, "dragData", undefined)
    await flush()
    dispose()
    const dd = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m): m is Extract<Mutation, { op: "setDragData" }> => m.op === "setDragData")
    expect(dd[dd.length - 1]?.data).toBe("")
  })
})

describe("canvas draw list (P8)", () => {
  test("drawList on canvas emits setDrawList with the items verbatim", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let cv: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      cv = R.createElement("canvas")
      R.insert(root, cv, null, null)
      return root
    }, container)
    await flush()
    const items = [
      { type: "rect", x: 0, y: 0, w: 100, h: 50, color: "#7aa2f7", cornerRadius: 4 },
      { type: "path", points: [0, 50, 50, 0, 100, 50], color: "#f7768e", strokeWidth: 2 },
      { type: "text", x: 8, y: 30, text: "Q3", size: 13, color: "#c0caf5" },
    ] as const
    R.setProp(cv!, "drawList", items)
    await flush()
    dispose()
    const dl = rec.batches
      .flatMap((b) => b.mutations)
      .find((m): m is Extract<Mutation, { op: "setDrawList" }> => m.op === "setDrawList")
    expect(dl?.items).toEqual(items)
  })

  test("drawList on non-canvas warns and sends nothing; canvas children are refused client-side", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let dv: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      dv = R.createElement("div")
      R.insert(root, dv, null, null)
      return root
    }, container)
    await flush()
    const warn = console.warn
    const calls: string[] = []
    console.warn = (m: string) => calls.push(m)
    try {
      R.setProp(dv!, "drawList", [{ type: "rect", x: 0, y: 0, w: 1, h: 1, color: "#fff" }])
      await flush()
    } finally {
      console.warn = warn
    }
    dispose()
    expect(calls.some((m) => m.includes("canvas"))).toBe(true)
    expect(
      rec.batches.flatMap((b) => b.mutations).some((m) => m.op === "setDrawList"),
    ).toBe(false)
  })
})

describe("media + overlays (P10)", () => {
  test("src routes by tag; deferred/anchor emit their mutations", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let icon: ReturnType<typeof R.createElement> | null = null
    let photo: ReturnType<typeof R.createElement> | null = null
    let pop: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      icon = R.createElement("svg")
      photo = R.createElement("img")
      pop = R.createElement("div")
      for (const n of [icon, photo, pop]) R.insert(root, n, null, null)
      return root
    }, container)
    await flush()
    R.setProp(icon!, "src", "<svg xmlns='http://www.w3.org/2000/svg'/>")
    R.setProp(icon!, "color", "#7aa2f7")
    R.setProp(photo!, "src", "/tmp/pic.png")
    R.setProp(photo!, "deferred", true)
    R.setProp(pop!, "anchor", "topRight")
    await flush()
    dispose()
    const muts = rec.batches.flatMap((b) => b.mutations)
    expect(muts).toContainEqual({ op: "setText", id: expect.anything(), text: "<svg xmlns='http://www.w3.org/2000/svg'/>" })
    expect(muts).toContainEqual(expect.objectContaining({ op: "setSrc", src: "/tmp/pic.png" }))
    expect(muts).toContainEqual(expect.objectContaining({ op: "setDeferred", deferred: true }))
    expect(muts).toContainEqual(expect.objectContaining({ op: "setAnchored", anchor: "topRight" }))
  })

  test("anchor rejects unknown corners; null clears", async () => {
    const rec = recording()
    const { renderer: R, render, flush } = createSolidRenderer(rec.send)
    const container = R.createElement("#root")
    let dv: ReturnType<typeof R.createElement> | null = null
    const dispose = render(() => {
      const root = R.createElement("div")
      dv = root
      return root
    }, container)
    await flush()
    const warn = console.warn
    const calls: string[] = []
    console.warn = (m: string) => calls.push(m)
    try {
      R.setProp(dv!, "anchor", "middle" as never)
      await flush()
      R.setProp(dv!, "anchor", null)
      await flush()
    } finally {
      console.warn = warn
    }
    dispose()
    expect(calls.some((m) => m.includes("anchor"))).toBe(true)
    const anchored = rec.batches
      .flatMap((b) => b.mutations)
      .filter((m): m is Extract<Mutation, { op: "setAnchored" }> => m.op === "setAnchored")
    expect(anchored).toHaveLength(1)
    expect(anchored[0]?.anchor).toBeNull()
  })
})
