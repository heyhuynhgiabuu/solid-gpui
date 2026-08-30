import { spawnHelper, type HelperConnection } from "@solid-gpui/client"
import { appWindow, dialog as dialogApi, shell as shellApi, type CommandChannel } from "./desktop"
import { createMenus, type MenuSpecInput } from "./menus"

const bindWindow = (c: CommandChannel) => ({
  setTitle: (title: string) => appWindow.setTitle(c, title),
  minimize: () => appWindow.minimize(c),
  zoom: () => appWindow.zoom(c),
  toggleFullscreen: () => appWindow.toggleFullscreen(c),
  activate: () => appWindow.activate(c),
})

const bindDialogs = (c: CommandChannel) => ({
  message: dialogApi.message.bind(null, c),
  openFile: dialogApi.openFile.bind(null, c),
  saveFile: dialogApi.saveFile.bind(null, c),
})

const bindShell = (c: CommandChannel) => ({
  revealPath: (path: string) => shellApi.revealPath(c, path),
  openWithSystem: (path: string) => shellApi.openWithSystem(c, path),
})
import { createSolidRenderer, type HostNode, type SolidGpuiRenderer } from "./renderer"
import { makeH, type H } from "./h"
import { assertReactivityLive } from "./reactivity-canary"

export interface RenderOptions {
  /** Reuse an existing connection (e.g. across bun --hot remounts). */
  connection?: HelperConnection
}

export interface RenderHandle {
  connection: HelperConnection
  /** Imperative window operations bound to this connection. */
  window: ReturnType<typeof bindWindow>
  /** Modal dialogs bound to this connection. */
  dialog: ReturnType<typeof bindDialogs>
  /** OS integrations bound to this connection. */
  shell: ReturnType<typeof bindShell>
  /** Application menu bar (P9). */
  menus: { set: (specs: readonly MenuSpecInput[]) => Promise<void> }
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
  // Check reactivity BEFORE spawning: a canary throw must not leak a helper
  // process the caller never received a handle for.
  await assertReactivityLive()
  const connection = opts.connection ?? spawnHelper({ mode: "window" })
  return mount(connection, {}, code)
}

/**
 * Shared mount path for every entry point (render(), the JSX runtime).
 * Everything that wires a suite to a live helper — event routing included —
 * happens HERE; hand-rolling this outside has silently broken event routing
 * twice (see MEMORY "BYPASSED-SEAM BUG"). `onSuite` lets alternative
 * authoring surfaces bind their module-level bindings before user code runs.
 */
export async function mount(
  connection: HelperConnection,
  options: { onSuite?: (suite: SolidGpuiRenderer) => void },
  code: (h: H) => HostNode,
): Promise<RenderHandle> {
  const { renderer, render, flush, handler, removeNode, firstChild, nextSibling } =
    createSolidRenderer(async (batch) => {
      // Route through the client's per-seq correlation; ReplyError propagates.
      return connection.sendBatch(batch)
    })
  void options
  const suite: SolidGpuiRenderer = {
    renderer,
    render,
    flush,
    handler,
    removeNode,
    firstChild,
    nextSibling,
  }
  options.onSuite?.(suite)
  const h = makeH(renderer)
  const menus = createMenus(connection)
  const container = renderer.createElement("#root")
  let activeDispose = render(() => code(h), container)
  await flush()
  // Event backchannel: helper clicks → handler registry lookup → invoke →
  // flush. flush() pumps Solid's scheduler until the queue settles, so it is
  // safe to call immediately after the synchronous handler returns.
  connection.onEvent((event) => {
    // Menu events are app-level (P9): the menu registry owns them.
    if (event.type === "menu") {
      menus.handleEvent(event)
      return
    }
    const fn = handler(event.id, event.eventType)
    if (fn === undefined) {
      console.warn(
        `[solid-gpui] no handler for ${event.eventType} on element ${event.id} ` +
          `(stale node or missing listener?)`,
      )
      return
    }
    let threw: unknown
    try {
      // The full decoded event (key/modifiers for keyDown/keyUp, position for
      // pointer events) is the handler's argument — matching DOM callbacks.
      fn(event)
    } catch (err) {
      // A user handler must not kill the host process (this callback runs
      // from the readline loop) nor skip the flush of mutations applied
      // before the throw.
      threw = err
    }
    void flush()
      .catch((err) => {
        console.error("[solid-gpui] event-triggered flush failed:", err)
      })
      .then(() => {
        if (threw !== undefined) console.error("[solid-gpui] onClick handler threw:", threw)
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
    // Desktop sugar (P4): window/dialog/shell bound to this connection.
    window: bindWindow(connection),
    dialog: bindDialogs(connection),
    shell: bindShell(connection),
    /** Application menu bar (P9): set replaces the whole bar. */
    menus: {
      set: (specs: readonly MenuSpecInput[]) => menus.set(specs),
    },
  }
}
