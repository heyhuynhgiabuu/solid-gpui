/**
 * List-specific commands (P5) over an existing command channel.
 */
import type { SolidGpuiCommand, JsonValue } from "@solid-gpui/protocol"
import type { CommandChannel } from "./desktop"

/**
 * Seq namespace: list commands count from 2_000_000 — disjoint from the
 * desktop module (1_000_000+) and the renderer's batches (1..), per the
 * client's disjoint-range contract; wraps at u32 max like desktop.
 */
let nextSeq = 2_000_000

function seq(): number {
  nextSeq = (nextSeq + 1) % 0xffff_ffff
  return nextSeq
}

/** Virtualized list commands. */
export const list = {
  /** Bring item `index` to the list's viewport top (clamped to count). */
  async scrollToItem(
    connection: CommandChannel,
    id: number,
    index: number,
  ): Promise<void> {
    await connection.sendCommand({ type: "scrollToItem", seq: seq(), id, index })
  },
}
