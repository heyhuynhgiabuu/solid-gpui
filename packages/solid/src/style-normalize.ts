/**
 * Shorthand expansion (P1-d): CSS-familiar compound keys expand to the
 * physical keys the helper applies. Pure — same input, same output, unknown
 * keys pass through untouched (the wire's open style-key rule).
 */
import type { StyleMap } from "@solid-gpui/protocol"

type StyleDict = Record<string, string | number>

/** Each shorthand fans out to physical keys; last-write-wins per physical
 *  key matches CSS cascade order within one object (later wins). */
const EXPANSIONS: Readonly<Record<string, readonly string[]>> = {
  padding: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
  paddingX: ["paddingLeft", "paddingRight"],
  paddingY: ["paddingTop", "paddingBottom"],
  margin: ["marginTop", "marginRight", "marginBottom", "marginLeft"],
  marginX: ["marginLeft", "marginRight"],
  marginY: ["marginTop", "marginBottom"],
  inset: ["top", "right", "bottom", "left"],
  size: ["width", "height"],
}

export function expandShorthands(style: StyleMap): StyleMap {
  const out: StyleDict = {}
  for (const [key, value] of Object.entries(style)) {
    const physical = EXPANSIONS[key]
    if (physical && value !== null && value !== undefined) {
      for (const k of physical) out[k] = value
    } else {
      out[key] = value
    }
  }
  return out as StyleMap
}
