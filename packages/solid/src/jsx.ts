/**
 * Module-level JSX runtime for babel-preset-solid { generate: "universal" }.
 *
 * The preset emits imports from THIS module (configure moduleName:
 * "@solid-gpui/solid/jsx"): createElement, createTextNode, insertNode,
 * insert, setProp, effect, createComponent — plus flow components (Show,
 * For, ...) re-exported from solid-js. The emitted call shapes were
 * verified empirically against @dom-expressions/babel-plugin-jsx
 * 0.50.0-next.44 (see S15a recon in TODO.md).
 *
 * Bindings delegate to ONE suite. Tests/embeddings inject a suite via
 * initJsxRuntime(send); apps go through mountJsx(), which spawns the helper
 * and wires events via the shared mount() path in render.ts (never wire a
 * suite to a connection by hand — that bypass has broken event routing
 * twice).
 */
import { Show, For, Switch, Match } from "solid-js"
import { createSolidRenderer, type HostNode } from "./renderer"
import { mount } from "./render"
import type { RenderHandle } from "./render"
import type { Send } from "./renderer"
import { spawnHelper } from "@solid-gpui/client"

let suite: ReturnType<typeof createSolidRenderer> | null = null

/**
 * The raw universal Renderer echoes back every method the config object
 * provided (setProperty/effect are ours), but @solidjs/universal's
 * `Renderer<HostNode>` type predates those extras — cast once here, at the
 * module boundary that owns the contract.
 */
interface RawSuiteMethods {
  setProp(node: HostNode, name: string, value: unknown, prev?: unknown): void
  createComponent(comp: unknown, props: unknown): unknown
  insert(
    parent: HostNode,
    value: unknown,
    marker?: HostNode | null,
    current?: HostNode | null,
  ): void
  effect(compute: () => unknown, commit: (values: never, prev: never) => void): void
}
function raw(): NonNullable<typeof suite> & RawSuiteMethods {
  return s().renderer as unknown as NonNullable<typeof suite> & RawSuiteMethods
}

/** Inject a suite (tests, embeddings with their own transport). */
export function initJsxRuntime(send: Send): ReturnType<typeof createSolidRenderer> {
  suite = createSolidRenderer(send)
  return suite
}

/** Drop the injected suite (between tests). */
export function resetJsxRuntime(): void {
  suite = null
}

function s(): NonNullable<typeof suite> {
  if (!suite) {
    throw new Error(
      "[solid-gpui] JSX runtime not initialized. Use mountJsx(...) for apps, " +
        "or initJsxRuntime({ send }) for tests/embeddings.",
    )
  }
  return suite
}

/** Mount a JSX-authored tree in a fresh helper window (the app entry). */
export async function mountJsx(code: () => HostNode): Promise<RenderHandle> {
  const connection = spawnHelper({ mode: "window" })
  return mount(connection, { onSuite: (next) => (suite = next) }, code)
}

/**
 * createElement(tag, props?): compiled JSX passes static attributes here.
 * Every prop flows through setProperty so it takes the SAME paths as h() —
 * style maps, event handlers, markdown source, text runs, input
 * value/placeholder, transitionMs animation diffing.
 */
export function createElement(tag: string, props?: Record<string, unknown>): HostNode {
  const el = s().renderer.createElement(tag)
  if (props) {
    for (const [name, value] of Object.entries(props)) {
      // Universal's echoed setProp dispatches internally: style maps go to
      // our config setProperty per key, event names hit our handler paths.
      raw().setProp(el, name, value)
    }
  }
  return el
}

export function createTextNode(text: unknown): HostNode {
  // Universal's Renderer types text as string, but compiled static children
  // can be raw expression values; coerce like the renderer config does.
  return s().renderer.createTextNode(text == null ? "" : String(text))
}

export function insertNode(parent: HostNode, node: HostNode, anchor?: HostNode): void {
  s().renderer.insertNode(parent, node, anchor)
}

export function removeNode(parent: HostNode, node: HostNode): void {
  s().removeNode(parent, node)
}

export function insert(
  parent: HostNode,
  value: unknown,
  marker?: HostNode | null,
  current?: HostNode | null,
): void {
  // Universal's insert handles accessor-or-value and markers.
  raw().insert(parent, value, marker ?? null, current ?? null)
}

/**
 * The two-arg effect the universal preset emits for dynamic props:
 * compute(tracked) → commit(values, prevValues). The ECHOED binding from
 * createRenderer wraps solid's createRenderEffect and empirically supports
 * object-returning computes with prev-value diffing exactly as the preset
 * expects (.pi/effect-probe.ts: [[10,undefined],[20,10]] on set(2)).
 */
export function effect(compute: () => unknown, commit: (values: never, prev: never) => void): void {
  raw().effect(compute as never, commit as never)
}

export function setProp(node: HostNode, name: string, value: unknown, prev?: unknown): void {
  raw().setProp(node, name, value, prev)
}

export function createComponent(comp: unknown, props: unknown): unknown {
  return raw().createComponent(comp, props)
}

// Flow components are renderer-agnostic: re-exported from solid-js so the
// preset's builtIns imports resolve from this module.
export { Show, For, Switch, Match }
