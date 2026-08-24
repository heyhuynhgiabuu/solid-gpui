/**
 * Numeric id of a host element on the native side.
 *
 * Valid range is 1..=2^32-1; 0 is reserved (never a real element) so an
 * unset/zero id is always detectable as a bug on both sides of the wire.
 */
export type ElementId = number & { readonly __brand: "ElementId" }

/** Authoring-time constructor. Throws on out-of-range values. */
export function elementId(n: number): ElementId {
  if (!Number.isInteger(n) || n < 1 || n > 0xffff_ffff) {
    throw new RangeError(`ElementId must be an integer in 1..=4294967295, got ${n}`)
  }
  return n as ElementId
}

/** Runtime guard for decoded (untrusted) values. */
export function isElementIdValue(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 0xffff_ffff
  )
}
