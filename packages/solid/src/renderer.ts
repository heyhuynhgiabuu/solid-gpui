import { createRenderer, type Renderer } from "@solidjs/universal"
import { flush as flushSolid } from "solid-js"
import {
  elementId,
  type EventType,
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
}

export interface SolidGpuiRenderer {
  renderer: Renderer<HostNode>
  /** Mount under a container; returns a disposer that also destroys the
   *  mounted root (universal's dev-build render does not clean up). */
  render(code: () => HostNode, container: HostNode): () => void
  /** Flush queued mutations as one batch through `send`. No-op when idle. */
  flush(): Promise<void>
  /** Handler registry for future event backchannel (passive in v1). */
  handler(id: number, event: EventType): (() => void) | undefined
}

/**
 * Create a Solid universal renderer that records DOM-like mutations and
 * flushes them as protocol batches. `send` is the transport seam: a recording
 * function in tests, the real helper connection in production.
 */
export function createSolidRenderer(send: Send): SolidGpuiRenderer {
  let nextId = 0
  let seq = 0
  const queue: Mutation[] = []
  const shadow = new Map<number, { parent: HostNode | null; children: HostNode[] }>()
  const handlers = new Map<string, () => void>()
  let topNode: HostNode | null = null

  const alloc = (kind: HostNode["kind"], tag: string): HostNode => {
    const id = ++nextId
    const node: HostNode = { kind, id, tag }
    shadow.set(id, { parent: null, children: [] })
    return node
  }

  const push = (m: Mutation): void => {
    queue.push(m)
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
        elementType: tag === "text" ? "text" : "div",
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
          handlers.set(`${node.id}:${event}`, value as () => void)
          push({ op: "setEventListener", id, eventType: event, enabled: true })
        } else {
          handlers.delete(`${node.id}:${event}`)
          push({ op: "setEventListener", id, eventType: event, enabled: false })
        }
        return
      }
      // Unknown props are ignored in v1 (no setCustomProp element yet).
      void prev
    },

    insertNode(parent: HostNode, node: HostNode, anchor?: HostNode) {
      if (parent.kind === "container") {
        // Mounting under the container = becoming the root.
        topNode = node
        push({ op: "setRoot", id: elementId(node.id) })
      } else {
        const entry = shadow.get(parent.id)!
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

    removeNode(parent: HostNode, node: HostNode) {
      if (parent.kind !== "container") {
        push({
          op: "removeChild",
          parentId: elementId(parent.id),
          childId: elementId(node.id),
        })
        const entry = shadow.get(parent.id)
        if (entry) {
          const i = entry.children.indexOf(node)
          if (i >= 0) entry.children.splice(i, 1)
        }
      }
      shadow.get(node.id)!.parent = null
    },

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
    // Solid 2 defers render/effects through its own queue (universal render
    // drains it with a tail flush); drain it first so mutations queued by
    // this tick's effects land in the batch below.
    flushSolid()
    if (queue.length === 0) return
    const batch: MutationBatch = { v: 1, seq: ++seq, mutations: queue.splice(0) }
    await send(batch)
  }

  return {
    renderer,
    render: renderWithDispose,
    flush,
    handler: (id, event) => handlers.get(`${id}:${event}`),
  }
}
