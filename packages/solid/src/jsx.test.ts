/**
 * JSX runtime tests (S15): the bindings babel-preset-solid { universal }
 * emits must route through the SAME suite machinery as h()/render().
 * The emitted call shapes are pinned by the compile-surface test at the
 * bottom — if the preset starts importing something we don't export, it
 * fails loudly instead of breaking user builds.
 */
import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import {
  initJsxRuntime,
  resetJsxRuntime,
  createElement,
  createTextNode,
  insertNode,
  insert,
  setProp,
  effect,
  Show,
  For,
} from "./jsx"
import type { Mutation, MutationBatch } from "@solid-gpui/protocol"
import type { Send } from "./renderer"

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

describe("jsx runtime bindings", () => {
  test("createElement applies static props through setProperty paths", async () => {
    const rec = recording()
    const suite = initJsxRuntime(rec.send)
    try {
      const el = createElement("div", {
        style: { display: "flex", gap: 8 },
        onClick: () => {},
      })
      expect(el.tag).toBe("div")
      await suite.flush()
      const ops = rec.batches.flatMap((b) => b.mutations.map((m) => m.op))
      expect(ops).toContain("setStyle")
      expect(ops).toContain("setEventListener")
    } finally {
      resetJsxRuntime()
    }
  })

  test("markdown source prop flows to setText via setProp", async () => {
    const rec = recording()
    const suite = initJsxRuntime(rec.send)
    try {
      const md = createElement("markdown", { source: "# v1" })
      setProp(md, "source", "# v2")
      await suite.flush()
      const texts = rec.batches
        .flatMap((b) => b.mutations)
        .filter((m): m is Extract<Mutation, { op: "setText" }> => m.op === "setText")
        .map((m) => m.text)
      expect(texts).toEqual(["# v1", "# v2"])
    } finally {
      resetJsxRuntime()
    }
  })

  test("two-arg effect drives reactive style + source updates", async () => {
    const rec = recording()
    const suite = initJsxRuntime(rec.send)
    try {
      const [dark, setDark] = createSignal(true)
      const [doc, setDoc] = createSignal("# a")

      // Mirror the exact emit shape from the recon probe:
      // _$effect(() => ({ e, t }), ({ e, t }, _p$) => { ... !== _p$?.e && ... })
      const el = createElement("div")
      const mdEl = createElement("markdown")
      let prev: { e?: unknown; s?: unknown } | undefined
      effect(
        () => ({
          e: dark() ? "#111" : "#eee",
          s: doc(),
        }),
        (values: { e: unknown; s: unknown }) => {
          values.e !== prev?.e && setProp(el, "style", { backgroundColor: values.e })
          values.s !== prev?.s && setProp(mdEl, "source", values.s)
          prev = values
        },
      )

      await new Promise((r) => setTimeout(r, 0))
      setDark(false)
      setDoc("# b")
      await new Promise((r) => setTimeout(r, 0))
      await suite.flush()

      const texts = rec.batches
        .flatMap((b) => b.mutations)
        .filter((m): m is Extract<Mutation, { op: "setText" }> => m.op === "setText")
        .map((m) => m.text)
      expect(texts).toContain("# b")
      const styles = rec.batches
        .flatMap((b) => b.mutations)
        .filter((m) => m.op === "setStyle")
      expect(styles.length).toBeGreaterThanOrEqual(2)
    } finally {
      resetJsxRuntime()
    }
  })

  test("insert routes text accessors; flow components re-exported", async () => {
    const rec = recording()
    const suite = initJsxRuntime(rec.send)
    try {
      const root = createElement("div")
      insert(root, createTextNode("static"), null, null)
      const [c] = createSignal(0)
      insert(root, c, null, null) // accessor form (compiled children)
      await suite.flush()

      const ops = rec.batches.flatMap((b) => b.mutations.map((m) => m.op))
      expect(ops.filter((op) => op === "setText").length).toBeGreaterThanOrEqual(1)
      expect(typeof Show).toBe("function")
      expect(typeof For).toBe("function")
    } finally {
      resetJsxRuntime()
    }
  })

  test("numeric/null text children stringify on the wire (setText is a string op)", async () => {
    const rec = recording()
    const suite = initJsxRuntime(rec.send)
    try {
      const root = createElement("div")
      insert(root, createTextNode(42), null, null) // static numeric child
      const [n] = createSignal(0)
      insert(root, n, null, null) // accessor child whose value is a number
      const [z] = createSignal<string | null>(null)
      insert(root, z, null, null) // null child renders as empty text
      await suite.flush()
      const texts = rec.batches
        .flatMap((b) => b.mutations)
        .filter((m): m is Extract<Mutation, { op: "setText" }> => m.op === "setText")
        .map((m) => m.text)
      expect(texts).toContain("42")
      expect(texts).toContain("0")
      expect(texts).toContain("")
    } finally {
      resetJsxRuntime()
    }
  })

  test("bindings throw with guidance before initialization", () => {
    resetJsxRuntime()
    expect(() => createElement("div")).toThrow(/initJsxRuntime|mountJsx/)
  })
})

/**
 * Compile-surface contract: whatever babel-preset-solid { universal } emits
 * for representative JSX must be importable from our runtime module. This is
 * the guard that makes preset upgrades safe — a renamed/added helper import
 * fails HERE, not in a user build.
 */
import { describe as d2, test as t2, expect as e2 } from "bun:test"
import * as jsxModule from "./jsx"

d2("compile-surface contract", () => {
  t2("every preset import resolves to a jsx-module export", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const babel = require("@babel/core")
    const preset = require("babel-preset-solid")
    const fixture = `
      const v = (
        <div style={{ gap: 8 }} onClick={() => {}}>
          <h1>Title {count()}</h1>
          <markdown source={doc()} />
          <input value={text()} onInput={(e) => setText(e.currentTarget.value)} />
          <Show when={ready()}>{label}</Show>
          <For each={items()}>{(item) => <li>{item}</li>}</For>
        </div>
      )
    `
    const out = babel.transformSync(fixture, {
      filename: "fixture.tsx",
      presets: [[preset, { moduleName: "@solid-gpui/solid/jsx", generate: "universal" }]],
      parserOpts: { plugins: ["jsx", "typescript"] },
    })
    const code = out.code as string
    expect(code).toContain('@solid-gpui/solid/jsx')

    const imports = [...code.matchAll(/import\s*\{\s*([a-zA-Z]+)\s+as\s+_\$[a-zA-Z]+\s*\}/g)]
      .map((m) => m[1])
      .filter((name): name is string => typeof name === "string")
    expect(imports.length).toBeGreaterThan(3)
    for (const name of imports) {
      expect(name in jsxModule || typeof (jsxModule as Record<string, unknown>)[name] !== "undefined").toBe(true)
    }
  })
})
