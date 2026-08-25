/**
 * Shorthand expansion (P1-d): CSS-familiar compound keys expand to the
 * physical keys the helper applies. Pure — same input, same output, unknown
 * keys pass through untouched (the wire's open style-key rule).
 */
import type { StyleMap } from "@solid-gpui/protocol"

type StyleDict = Record<string, string | number>
/** TRBL tuple — length is the perSide contract, so index access is total. */
type Sides = readonly [string | number, string | number, string | number, string | number]

/** Per-shorthand fan-out, given the CSS TRBL side values [t, r, b, l]. */
const FANOUTS: Readonly<
  Record<string, (s: Sides) => ReadonlyArray<[string, string | number]>>
> = {
  padding: (s) => [
    ["paddingTop", s[0]],
    ["paddingRight", s[1]],
    ["paddingBottom", s[2]],
    ["paddingLeft", s[3]],
  ],
  paddingX: (s) => [
    ["paddingLeft", s[3]],
    ["paddingRight", s[1]],
  ],
  paddingY: (s) => [
    ["paddingTop", s[0]],
    ["paddingBottom", s[2]],
  ],
  margin: (s) => [
    ["marginTop", s[0]],
    ["marginRight", s[1]],
    ["marginBottom", s[2]],
    ["marginLeft", s[3]],
  ],
  marginX: (s) => [
    ["marginLeft", s[3]],
    ["marginRight", s[1]],
  ],
  marginY: (s) => [
    ["marginTop", s[0]],
    ["marginBottom", s[2]],
  ],
  inset: (s) => [
    ["top", s[0]],
    ["right", s[1]],
    ["bottom", s[2]],
    ["left", s[3]],
  ],
  // size has no TRBL semantics: one value, both axes.
  size: (s) => [
    ["width", s[0]],
    ["height", s[0]],
  ],
}

/**
 * CSS TRBL fan-out for string values: 1 value → all sides; 2 → (v, h);
 * 3 → (top, h, bottom); 4 → (top, right, bottom, left). Numbers apply to
 * every side. Anything else (unparsable, mixed) returns null — the original
 * string then passes through and drops helper-side under the open-value
 * rule, exactly like a non-shorthand key with a junk value.
 */
function perSide(value: string | number): Sides | null {
  if (typeof value === "number") return [value, value, value, value]
  const parts = value.trim().split(/\s+/)
  if (parts.some((p) => !/^-?[\d.]+(px|rem|%)?$/.test(p))) return null
  const [a = "", b = "", c = "", d = ""] = parts
  switch (parts.length) {
    case 1:
      return [a, a, a, a]
    case 2:
      return [a, b, a, b]
    case 3:
      return [a, b, c, b]
    case 4:
      return [a, b, c, d]
    default:
      return null
  }
}

export function expandShorthands(style: StyleMap): StyleMap {
  const out: StyleDict = {}
  for (const [key, value] of Object.entries(style)) {
    const fanout = FANOUTS[key]
    if (fanout && value !== null && value !== undefined) {
      const sides = perSide(value)
      if (sides) {
        for (const [physical, v] of fanout(sides)) out[physical] = v
        continue
      }
    }
    out[key] = value
  }
  return out as StyleMap
}
