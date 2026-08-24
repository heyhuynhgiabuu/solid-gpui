/** A style value is either a raw number (px where numeric) or a string.
 *
 * Number fidelity note: exact integer values beyond 2^53-1 are guaranteed only
 * on the Rust side (serde_json::Number); JS silently rounds them. Irrelevant
 * for CSS-like values, but do not widen this type to ids/timestamps.
 */
export type StyleValue = string | number

/**
 * Compile-time authoring surface for v1 style keys.
 *
 * Decode is permissive about unknown keys on purpose: an older helper must
 * ignore style keys it does not know instead of rejecting the whole batch
 * (forward compatibility). The closed union only governs what the renderer
 * may author.
 *
 * `overflow` takes a closed value set: "scroll" (both axes), "scrollX",
 * "scrollY". Unknown values are ignored exactly like unknown keys — the
 * renderer never clips content that overflow ("hidden" is not supported).
 */
export type StyleKey =
  | "width"
  | "height"
  | "minWidth"
  | "minHeight"
  | "padding"
  | "backgroundColor"
  | "color"
  | "display"
  | "flexDirection"
  | "gap"
  | "flexGrow"
  | "flexShrink"
  | "alignItems"
  | "justifyContent"
  | "overflow"
  | "borderRadius"
  | "opacity"
  | "cursor"
  | "fontSize"
  | "fontWeight"

export type StyleMap = { readonly [K in StyleKey]?: StyleValue }
