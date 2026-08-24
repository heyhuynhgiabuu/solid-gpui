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
  const dispose = render(() => code(h), container)
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
    dispose: async () => {
      dispose()
      await flush()
      await connection.close()
    },
  }
}
