import { spawnHelper, type HelperConnection } from "@solid-gpui/client"
import { createSolidRenderer, type HostNode, type SolidGpuiRenderer } from "./renderer"

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
 * Mount a Solid tree into a native GPUI window. Returns after the initial
 * batch is acked. `connection` reuse is the bun --hot remount pattern: the
 * window persists, only the tree is swapped.
 */
export async function render(
  code: () => HostNode,
  opts: RenderOptions = {},
): Promise<RenderHandle> {
  const connection = opts.connection ?? spawnHelper({ mode: "window" })
  const { renderer, render, flush, handler, removeNode, firstChild, nextSibling } =
    createSolidRenderer(async (batch) => {
      // Route through the client's per-seq correlation; ReplyError propagates.
      return connection.sendBatch(batch)
    })
  // Event backchannel: helper clicks → handler registry lookup → invoke.
  // Handlers are keyed `${id}:${eventType}` by the renderer's mutation apply.
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
  })
  const container = renderer.createElement("#root")
  const dispose = render(code, container)
  await flush()
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
