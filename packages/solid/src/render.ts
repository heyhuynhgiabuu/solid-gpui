import { spawnHelper, type HelperConnection } from "@solid-gpui/client"
import { createSolidRenderer, type HostNode, type SolidGpuiRenderer } from "./renderer"
import { makeH, type H } from "./h"

export interface RenderOptions {
  /** Reuse an existing connection (e.g. across bun --hot remounts). */
  connection?: HelperConnection
}

export interface RenderHandle {
  connection: HelperConnection
  renderer: SolidGpuiRenderer
  container: HostNode
  /** Remount a new tree in the same window/connection (bun --hot pattern).
   *
   * Runs through the SAME renderer suite, so the element-id sequence keeps
   * increasing (a fresh suite would collide with ids live in the helper's
   * retained tree) and the event routing stays attached. The wire-side old
   * subtree is freed by insertNode's top-swap: destroyElement + setRoot.
   */
  update(code: (h: H) => HostNode): Promise<void>
  /** Dispose the Solid tree and close the helper window. */
  dispose(): Promise<void>
}

/**
 * Mount a Solid tree into a native GPUI window. `code` receives an `h` bound
 * to the internal host renderer; build your tree with it. Returns after the
 * initial batch is acked. `connection` reuse is the bun --hot remount pattern:
 * the window persists, only the tree is swapped.
 *
 * Event backchannel is wired automatically: helper clicks invoke the matching
 * `onClick` handler AND flush the resulting mutations — callers never flush
 * manually for user input.
 */
export async function render(
  code: (h: H) => HostNode,
  opts: RenderOptions = {},
): Promise<RenderHandle> {
  const connection = opts.connection ?? spawnHelper({ mode: "window" })
  const { renderer, render, flush, handler, removeNode, firstChild, nextSibling } =
    createSolidRenderer(async (batch) => {
      // Route through the client's per-seq correlation; ReplyError propagates.
      return connection.sendBatch(batch)
    })
  const h = makeH(renderer)
  const container = renderer.createElement("#root")
  let activeDispose = render(() => code(h), container)
  await flush()
  // Event backchannel: helper clicks → handler registry lookup → invoke →
  // flush. flush() pumps Solid's scheduler until the queue settles, so it is
  // safe to call immediately after the synchronous handler returns.
  connection.onEvent((event) => {
    const fn = handler(event.id, event.eventType)
    if (fn === undefined) {
      console.warn(
        `[solid-gpui] no handler for ${event.eventType} on element ${event.id} ` +
          `(stale node or missing listener?)`,
      )
      return
    }
    fn()
    void flush().catch((err) => {
      console.error("[solid-gpui] event-triggered flush failed:", err)
    })
  })
  return {
    connection,
    renderer: { renderer, render, flush, handler, removeNode, firstChild, nextSibling },
    container,
    update: async (code) => {
      // Dispose the previous Solid tree FIRST: it kills the old tree's
      // effects (zombie effects would touch destroyed nodes on the next
      // signal write — seen as replaceText(undefined) in testing) and emits
      // destroyElement for the old subtree; the fresh mount then setRoots
      // cleanly through the same id sequence.
      activeDispose()
      activeDispose = render(() => code(h), container)
      await flush()
    },
    dispose: async () => {
      activeDispose()
      await flush()
      await connection.close()
    },
  }
}
