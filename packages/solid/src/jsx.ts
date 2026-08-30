/**
 * Module-level JSX runtime for @solidjs/babel-plugin { generate: "universal" }.
 *
 * The compiler plugin emits imports from THIS module (configure moduleName:
 * "@solid-gpui/solid/jsx"): createElement, createTextNode, insertNode,
 * insert, setProp, effect, createComponent, and memo — plus flow components
 * (Show, For, ...) re-exported from solid-js. The emitted call shapes were
 * verified empirically against @solidjs/babel-plugin 2.0.0-rc.3.
 *
 * Bindings delegate to ONE suite. Tests/embeddings inject a suite via
 * initJsxRuntime(send); apps go through mountJsx(), which spawns the helper
 * and wires events via the shared mount() path in render.ts (never wire a
 * suite to a connection by hand — that bypass has broken event routing
 * twice).
 */
import { Show, For, Switch, Match, createMemo } from "solid-js"
import { createSolidRenderer, type HostNode } from "./renderer"
import { mount } from "./render"
import { assertReactivityLive } from "./reactivity-canary"
import type { RenderHandle, RenderOptions } from "./render"
export type { RenderOptions } from "./render"
import type { Send } from "./renderer"
import type { JSX } from "./jsx-runtime"
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

/** Mount a JSX-authored tree, optionally reusing an existing helper connection. */
export async function mountJsx(
  code: () => JSX.Element,
  opts: RenderOptions = {},
): Promise<RenderHandle> {
  // Check reactivity BEFORE spawning: a canary throw must not leak a helper
  // process the caller never received a handle for.
  await assertReactivityLive()
  const connection = opts.connection ?? spawnHelper({ mode: "window" })
  // A mounted root must be a HostNode at runtime. JSX's public element type
  // also includes component/flow values and primitives for child positions;
  // the universal renderer validates an invalid root during mount.
  return mount(connection, { onSuite: (next) => (suite = next) }, code as () => HostNode)
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
 * The two-arg effect the universal compiler plugin emits for dynamic props:
 * compute(tracked) → commit(values, prevValues). The ECHOED binding from
 * createRenderer wraps solid's createRenderEffect and empirically supports
 * object-returning computes with prev-value diffing exactly as the compiler
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
// compiler plugin's builtIns imports resolve from this module.
export { Show, For, Switch, Match, createMemo as memo }

/**
 * Universal `<Dynamic>`: render whichever component or intrinsic tag
 * `component` currently names —
 * `<Dynamic component={() => kind() === "a" ? A : B} prop={x()} />`.
 * Solid's core has no universal Dynamic, so this lives here.
 *
 * Ported from lxsmnsyc/solid-gpui (MIT), packages/solid-gpui/src/index.ts —
 * the accessor-returning shape is what the universal insert path unwraps.
 * Per-key getters in `rest` keep prop reads reactive across component swaps,
 * and the intrinsic-tag branch re-applies props through a tracked effect.
 */
export interface DynamicProps {
  /** A component function, or the tag name of an intrinsic element. */
  readonly component: string | ((props: Record<string, unknown>) => JSX.Element)
  readonly children?: unknown
  [key: string]: unknown
}

export function Dynamic(props: DynamicProps): JSX.Element {
  const rest: Record<string, unknown> = {}
  for (const key of Object.keys(props)) {
    if (key === "component") continue
    Object.defineProperty(rest, key, {
      get: () => props[key],
      enumerable: true,
      configurable: true,
    })
  }
  // An accessor on purpose: the universal insert unwraps functions, so a
  // component-identity swap re-renders through the normal insert path.
  return (() => {
    const component = props.component
    if (typeof component === "function") {
      return createComponent(component, rest) as JSX.Element
    }
    const element = createElement(component)
    const keys = Object.keys(rest).filter((key) => key !== "children")
    effect(
      () => {
        const snapshot: Record<string, unknown> = {}
        for (const key of keys) snapshot[key] = rest[key]
        return snapshot
      },
      (snapshot: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(snapshot)) setProp(element, key, value)
      },
    )
    const children = rest.children
    if (children !== undefined && children !== null) {
      const nodes = Array.isArray(children) ? children : [children]
      for (const node of nodes) insertNode(element, node as HostNode)
    }
    return element
  }) as unknown as JSX.Element
}
