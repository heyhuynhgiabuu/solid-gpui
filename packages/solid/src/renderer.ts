import { createRenderer, type Renderer } from "@solidjs/universal"
import {
  flush as flushSolid,
  createSignal as sigCreate,
  createEffect as sigEffect,
  createRoot as sigRoot,
} from "solid-js"
import {
  elementId,
  type ElementType,
  type EventType,
  type SolidGpuiEvent,
  type Mutation,
  type MutationBatch,
  type StyleMap,
} from "@solid-gpui/protocol"
import type { Ack } from "@solid-gpui/client"

/** Sends one batch; resolves on its ack, rejects on its error reply. */
export type Send = (batch: MutationBatch) => Promise<Ack>

/** A host element (or text node / the mount container sentinel). */
export interface HostNode {
  readonly kind: "element" | "text" | "container"
  id: number
  tag: string
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
  // v1 emits one "change" per edit for BOTH onInput and onChange (DOM
  // distinguishes commit from per-keystroke; we do not yet).
  onInput: "change",
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
  const handlers = new Map<string, (event: SolidGpuiEvent) => void>()
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

    createTextNode(value: string) {
      const node = alloc("text", "#text")
      push({ op: "createElement", id: elementId(node.id), elementType: "text" })
      push({ op: "setText", id: elementId(node.id), text: value })
      return node
    },

    replaceText(textNode: HostNode, value: string) {
      push({ op: "setText", id: elementId(textNode.id), text: value })
    },

    isTextNode(node: HostNode) {
      return node.kind === "text"
    },

    setProperty<T>(node: HostNode, name: string, value: T, prev?: T) {
      if (node.kind === "container") return
      const id = elementId(node.id)
      if (name === "style") {
        push({ op: "setStyle", id, style: (value ?? {}) as StyleMap })
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
      if (INPUT_STYLE_PROPS.has(name)) {
        // placeholder/minRows/maxRows render natively on input/textarea.
        push({ op: "setStyle", id, style: { [name]: value } as unknown as StyleMap })
        return
      }
      // Unknown props are ignored in v1 (no setCustomProp element yet).
      void prev
    },

    insertNode(parent: HostNode, node: HostNode, anchor?: HostNode) {
      if (parent.kind === "container") {
        const entry = shadow.get(parent.id)!
        // Remount without dispose: free the previous root on the wire —
        // setRoot alone would leave the old subtree allocated forever.
        if (topNode && topNode !== node && shadow.has(topNode.id)) {
          for (const id of collectSubtreeIds(topNode)) shadow.delete(id)
          push({ op: "destroyElement", id: elementId(topNode.id) })
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
        for (const id of collectSubtreeIds(topNode)) shadow.delete(id)
        push({ op: "destroyElement", id: elementId(topNode.id) })
        handlers.clear()
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
