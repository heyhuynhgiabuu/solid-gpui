/**
 * Application menu bar (P9, macOS) over an existing helper connection.
 *
 * Menus are app chrome, not tree mutations — they ride the seq-correlated
 * command channel like the P4 desktop operations. Every `set` REPLACES the
 * whole bar wholesale. Item picks come back as app-level `menu` events;
 * this module owns the itemId → callback registry and consumes those
 * events before element routing sees them.
 */
import type { SolidGpuiCommand, JsonValue, MenuSpec, MenuItemSpec, OsActionName } from "@solid-gpui/protocol"
import type { CommandChannel } from "./desktop"

/** Same channel shape as every other imperative surface (interface segregation). */
export interface MenuChannel {
  sendCommand(command: SolidGpuiCommand): Promise<JsonValue>
}

let nextSeq = 2_000_000

function seq(): number {
  // Disjoint namespace from batches (1..), desktop commands (1M..), list ops.
  nextSeq = (nextSeq + 1) % 0xffff_ffff
  return nextSeq
}

/** A clickable item carries an optional JS callback stripped before send. */
export type MenuItemInput = (
  | {
      readonly type: "item"
      readonly label: string
      /** Stable identifier echoed back in the pick event. */
      readonly id: string
      readonly keystroke?: string
      readonly disabled?: boolean
      readonly checked?: boolean
      readonly osAction?: OsActionName
    }
  | { readonly type: "separator" }
  | { readonly type: "submenu"; readonly name: string; readonly items: readonly MenuItemInput[] }
) & { /** Invoked when picked; omitted for osAction/native items. */ onPick?: () => void }

export type MenuSpecInput = {
  readonly name: string
  readonly items: readonly MenuItemInput[]
}

export function createMenus(channel: MenuChannel) {
  const pickers = new Map<string, () => void>()

  const registerItem = (item: MenuItemInput): void => {
    if (item.type === "item") {
      if (item.onPick) pickers.set(item.id, item.onPick)
      else pickers.delete(item.id)
      return
    }
    if (item.type === "submenu") for (const child of item.items) registerItem(child)
  }

  return {
    /** Replace the application menu bar wholesale. Resolves when acked. */
    async set(specs: readonly MenuSpecInput[]): Promise<void> {
      // Rebuild the registry atomically: stale ids from a previous bar must
      // not survive a replacement.
      pickers.clear()
      for (const spec of specs) for (const item of spec.items) registerItem(item)
      const wire = specs.map(
        (spec): MenuSpec => ({
          name: spec.name,
          items: spec.items.map(toWire),
        }),
      )
      await channel.sendCommand({ type: "setMenus", seq: seq(), menus: wire })
    },
    /** Consume one decoded event; returns false when it is not a menu pick. */
    handleEvent(event: { readonly type: string; readonly itemId?: string }): boolean {
      if (event.type !== "menu") return false
      const fn = pickers.get(event.itemId ?? "")
      if (fn === undefined) {
        console.warn(`[solid-gpui] no handler for menu item ${JSON.stringify(event.itemId ?? "")}`)
        return true
      }
      fn()
      return true
    },
    /** Test seam: whether an id currently has a registered picker. */
    has(id: string): boolean {
      return pickers.has(id)
    },
  }
}

/** Strip callbacks and optional-absents for the wire shape. */
function toWire(item: MenuItemInput): MenuItemSpec {
  if (item.type === "separator") return { type: "separator" }
  if (item.type === "submenu") {
    return { type: "submenu", name: item.name, items: item.items.map(toWire) }
  }
  return {
    type: "item",
    label: item.label,
    id: item.id,
    ...(item.keystroke !== undefined ? { keystroke: item.keystroke } : {}),
    ...(item.disabled !== undefined ? { disabled: item.disabled } : {}),
    ...(item.checked !== undefined ? { checked: item.checked } : {}),
    ...(item.osAction !== undefined ? { osAction: item.osAction } : {}),
  }
}
