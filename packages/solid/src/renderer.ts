import { createRenderer, type Renderer } from "@solidjs/universal"
import {
  flush as flushSolid,
  createSignal as sigCreate,
  createEffect as sigEffect,
  createRoot as sigRoot,
} from "solid-js"
import {
  elementId,
  ANIMATABLE_STYLE_KEYS,
  EASING_NAMES,
  type ElementType,
  type EasingName,
  type EventType,
  type SolidGpuiEvent,
  type Mutation,
  type MutationBatch,
  type StyleKey,
  type StyleMap,
} from "@solid-gpui/protocol"
import type { Ack } from "@solid-gpui/client"
import { expandShorthands } from "./style-normalize"

/** Sends one batch; resolves on its ack, rejects on its error reply. */
export type Send = (batch: MutationBatch) => Promise<Ack>

/** A host element (or text node / the mount container sentinel). */
export interface HostNode {
  readonly kind: "element" | "text" | "container"
  id: number
  tag: string
  /** transitionMs/transitionEasing props (animate future style changes). */
  transitionMs?: number
  transitionEasing?: EasingName
  /** Last style bag sent over the wire (diff base for animations). */
  lastStyle?: StyleMap
}

const EVENT_NAMES: Record<string, EventType> = {
  onClick: "click",
  onMouseDown: "mouseDown",
  onMouseUp: "mouseUp",
  onMouseEnter: "mouseEnter",
  onMouseLeave: "mouseLeave",
  onKeyDown: "keyDown",
  onKeyUp: "keyUp",
  onFocus: "focus",
  onBlur: "blur",
  onScroll: "scroll",
  // DOM semantics: input fires per edit (IME included); change commits on
  // blur/Enter (the helper tracks dirty state and emits it).
  onInput: "input",
  onChange: "change",
  onSubmit: "submit",
}

/**
 * Props that are NOT events and NOT the style bag but still render natively
 * on input/textarea. They flow as single-key style maps (the helper reads
 * placeholder/minRows/maxRows directly from the retained style).
 */
const INPUT_STYLE_PROPS = new Set(["placeholder", "minRows", "maxRows"])

/** Host tags the renderer maps to a specific elementType (everything else
 *  is a div). */
const TAG_ELEMENT_TYPES: Record<string, ElementType> = {
  input: "input",
  textarea: "textarea",
  list: "list",
  markdown: "markdown",
}

export interface SolidGpuiRenderer {
  renderer: Renderer<HostNode>
  /** Mount under a container; returns a disposer that also destroys the
   *  mounted root (the exported universal render does not clean up). */
  render(code: () => HostNode, container: HostNode): () => void
  /** Flush queued mutations as one batch through `send`. No-op when idle. */
  flush(): Promise<void>
  /** Handler registry: returns the user's handler for an id+eventType.
   *  Receives the full decoded event (keyDown carries key/modifiers). */
  handler(id: number, event: EventType): ((event: SolidGpuiEvent) => void) | undefined
  /** Shadow-tree queries + removal (universal's Renderer type hides these). */
  removeNode(parent: HostNode, node: HostNode): void
  firstChild(node: HostNode): HostNode | undefined
  nextSibling(node: HostNode): HostNode | undefined
}

/**
 * Create a Solid universal renderer that records DOM-like mutations and
 * flushes them as protocol batches. `send` is the transport seam: a recording
 * function in tests, the real helper connection in production.
 */
/** setText is a string op on the wire; compiled JSX hands raw expression
 *  values ({count()} can be a number, null renders as empty). */
function textOf(value: unknown): string {
  return value == null ? "" : String(value)
}

export function createSolidRenderer(send: Send): SolidGpuiRenderer {
  // Reactivity liveness probe: under the solid-js SSR stubs (node condition,
  // see README), effects never re-run and updates silently no-op. Warn once
  // so users discover the --conditions=browser requirement immediately.
  let probed = false
  const probe = (): void => {
    if (probed) return
    probed = true
    try {
      let ran = 0
      sigRoot((dispose) => {
        const [s, set] = sigCreate(0)
        sigEffect(() => {
          void s()
          ran++
        })
        set(1)
        dispose()
      })
      flushSolid()
      if (ran < 2 && typeof console !== "undefined") {
        console.warn(
          "[solid-gpui] Solid effects are not re-running in this runtime. " +
            "solid-js resolves to its non-reactive SSR build under the default 'node' condition — " +
            "run with --conditions=browser (see README).",
        )
      }
    } catch {
      // Probe must never break the host.
    }
  }
  probe()
  let nextId = 0
  let seq = 0
  const queue: Mutation[] = []
  const shadow = new Map<number, { parent: HostNode | null; children: HostNode[] }>()
  /** Element ids created on the wire but never attached (markdown children
   *  refused by insertNode). They exist helper-side, so subtree teardown must
   *  destroy each one explicitly — the helper's destroy of an ancestor walks
   * WIRE children only and would leak them forever. */
  const refusedChildren = new Set<number>()
  const handlers = new Map<string, (event: SolidGpuiEvent) => void>()
  /** Per-binding shortcut handlers, keyed `${nodeId}:${binding}`. */
  const keyHandlers = new Map<string, (event: SolidGpuiEvent) => void>()
  let topNode: HostNode | null = null
  let poisoned: string | null = null
  let disposedAll: (() => void) | null = null

  const alloc = (kind: HostNode["kind"], tag: string): HostNode => {
    const id = ++nextId
    const node: HostNode = { kind, id, tag }
    shadow.set(id, { parent: null, children: [] })
    return node
  }

  const push = (m: Mutation): void => {
    queue.push(m)
  }

  const removeNodeImpl = (parent: HostNode, node: HostNode): void => {
    if (parent.kind === "element" && parent.tag === "markdown") {
      // Children refused by insertNode live ONLY in the shadow bookkeeping
      // (no wire attach ever happened), so removal is shadow-only — emitting
      // removeChild would fail helper-side validation (not a child) and
      // poison the session. universal's reconcileArrays calls removeNode
      // unconditionally for leftovers, so this path is NOT theoretical.
      const entry = shadow.get(parent.id)
      if (entry) {
        for (let i = entry.children.indexOf(node); i >= 0; i = entry.children.indexOf(node)) {
          entry.children.splice(i, 1)
        }
      }
      shadow.get(node.id)!.parent = null
      refusedChildren.delete(node.id)
      return
    }
    if (parent.kind !== "container") {
      push({
        op: "removeChild",
        parentId: elementId(parent.id),
        childId: elementId(node.id),
      })
      const entry = shadow.get(parent.id)
      if (entry) {
        // Defensive: remove ALL occurrences (a corrupted history must not
        // compound; the wire op is single — the helper validates it).
        for (let i = entry.children.indexOf(node); i >= 0; i = entry.children.indexOf(node)) {
          entry.children.splice(i, 1)
        }
      }
    }
    shadow.get(node.id)!.parent = null
  }

  const renderer = createRenderer<HostNode>({
    createElement(tag: string) {
      // "#root" is the virtual mount container: it exists only for
      // parent/child bookkeeping in this process — never on the wire.
      if (tag === "#root") {
        const node: HostNode = { kind: "container", id: ++nextId, tag }
        shadow.set(node.id, { parent: null, children: [] })
        return node
      }
      const node = alloc("element", tag)
      push({
        op: "createElement",
        id: elementId(node.id),
        elementType: tag === "text" ? "text" : (TAG_ELEMENT_TYPES[tag] ?? "div"),
      })
      return node
    },

    // Compiled JSX hands raw expression values here ({count()} can be a
    // number); setText is a string op on the wire, so coerce at the boundary.
    createTextNode(value: unknown) {
      const node = alloc("text", "#text")
      const text = textOf(value)
      push({ op: "createElement", id: elementId(node.id), elementType: "text" })
      push({ op: "setText", id: elementId(node.id), text })
      return node
    },

    replaceText(textNode: HostNode, value: unknown) {
      push({ op: "setText", id: elementId(textNode.id), text: textOf(value) })
    },

    isTextNode(node: HostNode) {
      return node.kind === "text"
    },

    setProperty<T>(node: HostNode, name: string, value: T, prev?: T) {
      if (node.kind === "container") return
      const id = elementId(node.id)
      if (name === "transitionMs") {
        // Validate at the boundary: an invalid value emitted on the wire is
        // a decode error there and would poison the renderer (review B2).
        node.transitionMs =
          typeof value === "number" && Number.isInteger(value) && value >= 0
            ? value
            : undefined
        return
      }
      if (name === "transitionEasing") {
        node.transitionEasing =
          typeof value === "string" &&
          (EASING_NAMES as readonly string[]).includes(value)
            ? (value as EasingName)
            : undefined
        return
      }
      if (name === "hoverStyle" || name === "activeStyle") {
        // State layer (P1-c): value is a style map applied on top of the
        // base when gpui reports hover/active. Markdown renders helper-side
        // and rejects state layers — emitting would ack-fail and poison the
        // session (validation and rendering agree), so drop it here instead.
        if (node.tag === "markdown") return
        const state = name === "hoverStyle" ? "hover" : "active"
        const layer = expandShorthands((value ?? {}) as StyleMap)
        push({ op: "setStyle", id, style: layer, state })
        return
      }
      if (name === "style") {
        const next = expandShorthands((value ?? {}) as StyleMap)
        const prev = node.lastStyle
        node.lastStyle = next
        if (node.transitionMs && prev && node.tag === "markdown") {
          // Helper rejects setAnimation on markdown (static styles only);
          // emitting it would poison the session. Static setStyle below.
          if (typeof console !== "undefined") {
            console.warn(
              "[solid-gpui] <markdown> ignores transitionMs — it renders a static markdown document.",
            )
          }
        } else if (node.transitionMs && prev) {
          // A key animates only when BOTH ends are numeric and it changed —
          // mirroring the wire's numeric-start rule (animating an absent or
          // non-numeric start is an applyFailed on the helper and poisons
          // the renderer; review B2). Everything else flows statically.
          const targets: Record<string, number> = {}
          for (const k of Object.keys(next) as StyleKey[]) {
            const v = next[k]
            const p = prev[k]
            if (
              typeof v === "number" &&
              typeof p === "number" &&
              v !== p &&
              (ANIMATABLE_STYLE_KEYS as readonly string[]).includes(k)
            ) {
              targets[k] = v
            }
          }
          // The companion setStyle REPLACES the helper-side style map, so it
          // must carry the animated keys' PREVIOUS numeric values — omitting
          // them deletes the numeric start before setAnimation applies in
          // the same batch (applyFailed -> poison; review B1). Restating the
          // starts cannot snap: the setAnimation merge in the same batch
          // lands the targets before any render observes the style.
          const targetKeys = new Set(Object.keys(targets))
          const companion = Object.fromEntries(
            (Object.keys(next) as StyleKey[]).map((k) => [
              k,
              targetKeys.has(k) ? (prev[k] as number) : next[k],
            ]),
          ) as StyleMap
          push({ op: "setStyle", id, style: companion })
          if (Object.keys(targets).length > 0) {
            push({
              op: "setAnimation",
              id,
              target: targets as { [k in (typeof ANIMATABLE_STYLE_KEYS)[number]]?: number },
              transitionMs: node.transitionMs,
              ...(node.transitionEasing !== undefined
                ? { easing: node.transitionEasing }
                : {}),
            })
          }
          return
        }
        push({ op: "setStyle", id, style: next })
        return
      }
      if (name === "keys") {
        // Shortcut/sequence map: { "cmd-k": fn, "ctrl-x ctrl-s": fn }.
        // Bindings travel as one setKeyBindings; firing reports back as a
        // `keys` event whose key field names the matched binding.
        if (node.tag === "markdown") {
          if (typeof console !== "undefined") {
            console.warn(
              "[solid-gpui] <markdown> ignores keys — it renders a static document and fires no events.",
            )
          }
          return
        }
        const nodeId = node.id
        const map = (value ?? {}) as Record<string, unknown>
        const bindings: string[] = []
        for (const k of Object.keys(map)) {
          // Drop stale entries first (re-set replaces the whole map).
          keyHandlers.delete(`${nodeId}:${k}`)
          if (typeof map[k] === "function") {
            bindings.push(k)
            keyHandlers.set(`${nodeId}:${k}`, map[k] as (event: SolidGpuiEvent) => void)
          }
        }
        // Prefix-sharing is order-dependent: a binding that is a keystroke
        // prefix of a longer sequence shadows it (or vice versa) — only one
        // can ever fire. Deterministic, but tell the author instead of
        // silently killing a binding.
        if (bindings.length > 1 && typeof console !== "undefined") {
          for (let i = 0; i < bindings.length; i++) {
            const bi = bindings[i]
            if (bi === undefined) continue
            for (let j = 0; j < bindings.length; j++) {
              const bj = bindings[j]
              if (bi === undefined || bj === undefined) continue
              if (i !== j && bj.startsWith(bi + " ")) {
                console.warn(
                  `[solid-gpui] keys conflict on element #${nodeId}: "${bindings[i]}" is a prefix of "${bindings[j]}" — only the earlier entry in the map fires. Split the chord or rename one binding.`,
                )
              }
            }
          }
        }
        if (bindings.length > 0) {
          handlers.set(`${nodeId}:keys`, (event) => {
            const fn = keyHandlers.get(`${nodeId}:${event.key ?? ""}`)
            fn?.(event)
          })
          push({ op: "setEventListener", id, eventType: "keys", enabled: true })
        } else {
          handlers.delete(`${nodeId}:keys`)
          push({ op: "setEventListener", id, eventType: "keys", enabled: false })
        }
        push({ op: "setKeyBindings", id, bindings })
        return
      }
      if (node.tag === "markdown" && EVENT_NAMES[name]) {
        // Mirror the helper's honest contract: markdown accepts only
        // style/source; listeners never fire helper-side, so emitting one
        // would be acked-rejected (applyFailed) and poison the session.
        // (transitionMs/transitionEasing return before this point; the
        // animation path is guarded inside the style branch above.)
        if (typeof console !== "undefined") {
          console.warn(
            `[solid-gpui] <markdown> ignores ${String(name)} — it renders a static markdown document (style/source only).`,
          )
        }
        return
      }
      const event = EVENT_NAMES[name]
      if (event) {
        if (typeof value === "function") {
          handlers.set(`${node.id}:${event}`, value as (event: SolidGpuiEvent) => void)
          push({ op: "setEventListener", id, eventType: event, enabled: true })
        } else {
          handlers.delete(`${node.id}:${event}`)
          push({ op: "setEventListener", id, eventType: event, enabled: false })
        }
        return
      }
      if (name === "value" && (node.tag === "input" || node.tag === "textarea")) {
        // Controlled value (JS→helper): overwrites helper-side edits on apply.
        push({ op: "setValue", id, value: String(value ?? "") })
        return
      }
      if (name === "source" && node.tag === "markdown") {
        // Markdown content flows as ONE setText — the helper parses and
        // renders it entirely Rust-side (no per-block traffic).
        push({ op: "setText", id, text: String(value ?? "") })
        return
      }
      if (INPUT_STYLE_PROPS.has(name)) {
        // placeholder/minRows/maxRows render natively on input/textarea.
        push({ op: "setStyle", id, style: { [name]: value } as unknown as StyleMap })
        return
      }
      // Unknown props are ignored in v1 (no setCustomProp element yet).
      void prev
    },

    insertNode(parent: HostNode, node: HostNode, anchor?: HostNode) {
      if (parent.kind === "element" && parent.tag === "markdown") {
        // The helper owns the markdown element's rendered subtree and the
        // wire rejects attach on it (applyFailed poisons the session). Refuse
        // children client-side instead of emitting an op we know is invalid.
        // The node is still recorded in the shadow bookkeeping: dispose walks
        // the shadow tree and destroys these ids (they exist helper-side via
        // their createElement), so refusing must not leak elements, and
        // removeNode/getFirstChild/nextSibling stay consistent with what
        // universal believes about the tree.
        if (typeof console !== "undefined") {
          console.warn(
            "[solid-gpui] <markdown> takes a `source` prop; children are not rendered and were dropped.",
          )
        }
        const entry = shadow.get(parent.id)!
        const prior = entry.children.indexOf(node)
        if (prior >= 0) entry.children.splice(prior, 1)
        const anchorIndex = anchor ? entry.children.indexOf(anchor) : -1
        if (anchor && anchorIndex >= 0) {
          entry.children.splice(anchorIndex, 0, node)
        } else {
          entry.children.push(node)
        }
        shadow.get(node.id)!.parent = parent
        refusedChildren.add(node.id)
        return
      }
      if (parent.kind === "container") {
        const entry = shadow.get(parent.id)!
        // Remount without dispose: free the previous root on the wire —
        // setRoot alone would leave the old subtree allocated forever.
        if (topNode && topNode !== node && shadow.has(topNode.id)) {
          destroySubtree(topNode)
        }
        topNode = node
        entry.children = [node]
        push({ op: "setRoot", id: elementId(node.id) })
      } else {
        const entry = shadow.get(parent.id)!
        // Mirror the helper's attach semantics (retain-then-insert):
        // reconcileArrays moves call insertNode for nodes already in the
        // parent; without removing the prior occurrence the shadow tree
        // grows duplicates and later removals emit invalid ops.
        const prior = entry.children.indexOf(node)
        if (prior >= 0) entry.children.splice(prior, 1)
        const anchorIndex = anchor ? entry.children.indexOf(anchor) : -1
        if (anchor && anchorIndex >= 0) {
          push({
            op: "insertBefore",
            parentId: elementId(parent.id),
            childId: elementId(node.id),
            beforeId: elementId(anchor.id),
          })
          entry.children.splice(anchorIndex, 0, node)
        } else {
          push({
            op: "appendChild",
            parentId: elementId(parent.id),
            childId: elementId(node.id),
          })
          entry.children.push(node)
        }
      }
      shadow.get(node.id)!.parent = parent
    },

    removeNode: removeNodeImpl,

    cleanupNodes(_parent: HostNode, nodes: HostNode[]) {
      for (const n of nodes) {
        if (n.kind === "container") continue
        push({ op: "destroyElement", id: elementId(n.id) })
        refusedChildren.delete(n.id)
        shadow.delete(n.id)
      }
    },

    getParentNode(node: HostNode) {
      return shadow.get(node.id)?.parent ?? undefined
    },

    getFirstChild(node: HostNode) {
      return shadow.get(node.id)?.children[0] ?? undefined
    },

    getNextSibling(node: HostNode) {
      const entry = shadow.get(node.id)
      if (!entry?.parent) return undefined
      const siblings = shadow.get(entry.parent.id)?.children ?? []
      return siblings[siblings.indexOf(node) + 1] ?? undefined
    },
  })

  /** DFS-collect a subtree's ids from the shadow tree (dispose cleanup). */
  /** Tear down a mounted subtree: destroy the root (the helper cascades
   *  over WIRE children) plus every refused child in its shadow subtree —
   *  those were never attached, so only an explicit destroyElement frees
   *  them. Purges the shadow map so a prod double-dispose is a no-op. */
  function destroySubtree(root: HostNode): void {
    const ids = collectSubtreeIds(root)
    for (const id of ids) {
      shadow.delete(id)
      if (refusedChildren.delete(id)) {
        push({ op: "destroyElement", id: elementId(id) })
      }
    }
    push({ op: "destroyElement", id: elementId(root.id) })
  }

  function collectSubtreeIds(node: HostNode, out: number[] = []): number[] {
    out.push(node.id)
    for (const child of shadow.get(node.id)?.children ?? []) {
      collectSubtreeIds(child, out)
    }
    return out
  }

  function renderWithDispose(code: () => HostNode, container: HostNode): () => void {
    // The comment below replaced an earlier wrong one: in rc.1 the dev and
    // prod builds of @solidjs/universal are byte-identical, and NEITHER
    // exported render() runs cleanupNodes (only the internal base renderer
    // does). The self-destroy + shadow guard below is required everywhere.
    const baseDispose = renderer.render(code, container)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      baseDispose()
      // The dev build of @solidjs/universal does not run cleanupNodes on
      // dispose; the prod build does. Destroy the mounted root ourselves,
      // guarded by the shadow map so a prod double-call is a no-op.
      if (topNode && shadow.has(topNode.id)) {
        destroySubtree(topNode)
        handlers.clear()
        keyHandlers.clear()
        topNode = null
      }
    }
  }

  async function flush(): Promise<void> {
    // Solid 2 defers effects through its own scheduler (microtasks). Component
    // results resolve in STAGES (a stage may schedule the next), so a single
    // drain is not enough: loop drain → pump → collect until a full round
    // yields no mutations, sending each accumulated batch.
    for (let round = 0; round < 100; round++) {
      flushSolid()
      await Promise.resolve()
      if (queue.length === 0) {
        // One extra pump: a just-scheduled stage may only land now.
        flushSolid()
        await Promise.resolve()
        if (queue.length === 0) return
      }
      if (poisoned) throw new Error(`renderer poisoned by a failed batch: ${poisoned}`)
      const batch: MutationBatch = { v: 1, seq: ++seq, mutations: queue.splice(0) }
      try {
        await send(batch)
      } catch (err) {
        // Policy (v0.1): a failed batch means shadow and wire MAY have
        // diverged (partial apply on the helper). Poison the renderer:
        // only dispose() remains meaningful. No requeue — re-sending a
        // partially-applied batch would double-apply leading mutations.
        poisoned = err instanceof Error ? err.message : String(err)
        throw err
      }
    }
    throw new Error("flush(): solid did not settle within 100 rounds")
  }

  return {
    renderer,
    render: renderWithDispose,
    flush,
    handler: (id, event) => handlers.get(`${id}:${event}`),
    removeNode: removeNodeImpl,
    firstChild: (node) => shadow.get(node.id)?.children[0] ?? undefined,
    nextSibling: (node) => {
      const entry = shadow.get(node.id)
      if (!entry?.parent) return undefined
      const siblings = shadow.get(entry.parent.id)?.children ?? []
      return siblings[siblings.indexOf(node) + 1] ?? undefined
    },
  }
}
