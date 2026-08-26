/**
 * List-specific commands (P5) over an existing command channel.
 */
import type { SolidGpuiCommand, JsonValue } from "@solid-gpui/protocol"
import type { CommandChannel } from "./desktop"

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
