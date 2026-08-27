/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Gate 2: Tailwind-compatible SUBSET compiler — pure class-string → style-map
 * translation, zero dependencies, no wire surface (everything compiles into
 * the ops that already exist).
 *
 * The matrix deliberately mirrors what crates/helper/src/host.rs applies and
 * nothing more: an unparsed token is REPORTED (`unknown`), never half-mapped,
 * so the renderer can warn instead of the helper silently ignoring CSS the
 * user believes works. Deviations from browser Tailwind live in
 * docs/tailwind-subset.md.
 */

type StyleDict = Record<string, string | number>

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const

/** Tailwind v3 default palette, verbatim hexes. Rows run 50→950. */
const PALETTE: Readonly<Record<string, readonly string[]>> = {
  slate: ["#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155", "#1e293b", "#0f172a", "#020617"],
  gray: ["#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827", "#030712"],
  zinc: ["#fafafa", "#f4f4f5", "#e4e4e7", "#d4d4d8", "#a1a1aa", "#71717a", "#52525b", "#3f3f46", "#27272a", "#18181b", "#09090b"],
  neutral: ["#fafafa", "#f5f5f5", "#e5e5e5", "#d4d4d4", "#a3a3a3", "#737373", "#525252", "#404040", "#262626", "#171717", "#0a0a0a"],
  stone: ["#fafaf9", "#f5f5f4", "#e7e5e4", "#d6d3d1", "#a8a29e", "#78716c", "#57534e", "#44403c", "#292524", "#1c1917", "#0c0a09"],
  red: ["#fef2f2", "#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d", "#450a0a"],
  orange: ["#fff7ed", "#ffedd5", "#fed7aa", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c", "#9a3412", "#7c2d12", "#431407"],
  amber: ["#fffbeb", "#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#b45309", "#92400e", "#78350f", "#451a03"],
  yellow: ["#fefce8", "#fef9c3", "#fef08a", "#fde047", "#facc15", "#eab308", "#ca8a04", "#a16207", "#854d0e", "#713f12", "#422006"],
  lime: ["#f7fee7", "#ecfccb", "#d9f99d", "#bef264", "#a3e635", "#84cc16", "#65a30d", "#4d7c0f", "#3f6212", "#365314", "#1a2e05"],
  green: ["#f0fdf4", "#dcfce7", "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#166534", "#14532d", "#052e16"],
  emerald: ["#ecfdf5", "#d1fae5", "#a7f3d0", "#6ee7b7", "#34d399", "#10b981", "#059669", "#047857", "#065f46", "#064e3b", "#022c22"],
  teal: ["#f0fdfa", "#ccfbf1", "#99f6e4", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488", "#0f766e", "#115e59", "#134e4a", "#042f2e"],
  cyan: ["#ecfeff", "#cffafe", "#a5f3fc", "#67e8f9", "#22d3ee", "#06b6d4", "#0891b2", "#0e7490", "#155e75", "#164e63", "#083344"],
  sky: ["#f0f9ff", "#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0284c7", "#0369a1", "#075985", "#0c4a6e", "#082f49"],
  blue: ["#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a", "#172554"],
  indigo: ["#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#312e81", "#1e1b4b"],
  violet: ["#f5f3ff", "#ede9fe", "#ddd6fe", "#c4b5fd", "#a78bfa", "#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6", "#4c1d95", "#2e1065"],
  purple: ["#faf5ff", "#f3e8ff", "#e9d5ff", "#d8b4fe", "#c084fc", "#a855f7", "#9333ea", "#7e22ce", "#6b21a8", "#581c87", "#3b0764"],
  fuchsia: ["#fdf4ff", "#fae8ff", "#f5d0fe", "#f0abfc", "#e879f9", "#d946ef", "#c026d3", "#a21caf", "#86198f", "#701a75", "#4a044e"],
  pink: ["#fdf2f8", "#fce7f3", "#fbcfe8", "#f9a8d4", "#f472b6", "#ec4899", "#db2777", "#be185d", "#9d174d", "#831843", "#500724"],
  rose: ["#fff1f2", "#ffe4e6", "#fecdd3", "#fda4af", "#fb7185", "#f43f5e", "#e11d48", "#be123c", "#9f1239", "#881337", "#4c0519"],
}

/** Spacing: N units × 4px, `p-px`, decimals, negatives (margins only). */
const SPACING_KEYS: Readonly<Record<string, string>> = {
  p: "padding",
  px: "paddingX",
  py: "paddingY",
  pt: "paddingTop",
  pr: "paddingRight",
  pb: "paddingBottom",
  pl: "paddingLeft",
  m: "margin",
  mx: "marginX",
  my: "marginY",
  mt: "marginTop",
  mr: "marginRight",
  mb: "marginBottom",
  ml: "marginLeft",
}

const LENGTH_KEYS = new Set([...Object.keys(SPACING_KEYS), "gap", "w", "h", "min-w", "min-h", "size"])

const TEXT_SIZES: Readonly<Record<string, number>> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
  "7xl": 72,
  "8xl": 96,
  "9xl": 128,
}

const FONT_WEIGHTS: Readonly<Record<string, number>> = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
}

const RADII: Readonly<Record<string, number>> = {
  none: 0,
  sm: 2,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  "3xl": 24,
  full: 9999,
}

/** Accepted layout tokens whose helper mapping exists (or is a true no-op). */
const LAYOUT_TOKENS: Readonly<Record<string, StyleDict>> = {
  flex: { display: "flex" },
  // flexDirection defaults to row in gpui/taffy; emitting it would silently
  // no-op helper-side, so "flex-row" is a recognized NO-OP, not a mapping.
  "flex-col": { flexDirection: "column" },
  "items-center": { alignItems: "center" },
  "justify-center": { justifyContent: "center" },
  "flex-1": { flexGrow: 1, flexShrink: 1 },
  grow: { flexGrow: 1 },
  "grow-0": { flexGrow: 0 },
  shrink: { flexShrink: 1 },
  "shrink-0": { flexShrink: 0 },
  "cursor-pointer": { cursor: "pointer" },
}
const LAYOUT_NOOPS = new Set(["flex-row"])

function expandBracketHex(inner: string): string | null {
  // 3-digit expands; 6/8-digit pass through (the host applies 8-digit alpha
  // via rgba). 4-digit (#rgba shorthand) is REFUSED rather than silently
  // dropping its alpha digit.
  if (!/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/.test(inner)) return null
  if (inner.length === 4) {
    const a = inner.charAt(1)
    const b = inner.charAt(2)
    const c = inner.charAt(3)
    return `#${a}${a}${b}${b}${c}${c}`.toLowerCase()
  }
  return inner.toLowerCase()
}

/** `[10px]` / `[0.5rem]` / `[50%]` / `[7]` → px number or percent string. */
function parseBracketLength(inner: string): string | number | null {
  const m = /^(-?[\d.]+)(px|rem|%)?$/.exec(inner)
  const whole = m?.[1]
  if (whole === undefined) return null
  const n = Number.parseFloat(whole)
  if (!Number.isFinite(n)) return null
  const unit = m?.[2]
  if (unit === "rem") return n * 16
  if (unit === "%") return `${whole}%`
  return n
}

/** `2` → 8, `0.5` → 2, `px` → 1, `[...]` passthrough. */
function parseLength(value: string): string | number | null {
  if (value.startsWith("[") && value.endsWith("]")) {
    return parseBracketLength(value.slice(1, -1))
  }
  if (value === "px") return 1
  if (!/^\d*\.?\d+$/.test(value)) return null
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n * 4 : null
}

function parseColorValue(value: string): string | null {
  if (value === "white") return "#ffffff"
  if (value === "black") return "#000000"
  if (/^[a-z]+-\d{2,3}$/.test(value)) {
    const i = value.lastIndexOf("-")
    const hue = value.slice(0, i)
    const shade = value.slice(i + 1)
    const row = PALETTE[hue]
    if (row) {
      const idx = (SHADES as readonly string[]).indexOf(shade)
      const hex = idx >= 0 ? row[idx] : undefined
      if (hex !== undefined) return hex
    }
  }
  return null
}

function parseSimple(token: string, out: StyleDict): boolean {
  // Colors first so `text-*` resolves hue before size scale.
  if (token.startsWith("bg-")) {
    const c = token.startsWith("bg-") && token.length > 3 ? (token.startsWith("bg-") && token.length > 3 && token.charAt(3) === "[" ? expandBracketHex(token.slice(4, -1)) : parseColorValue(token.slice(3))) : null
    if (c !== null) {
      out.backgroundColor = c
      return true
    }
    return false
  }
  if (token.startsWith("text-")) {
    if (token.startsWith("text-[")) {
      const inner = token.slice(6, -1)
      const hex = expandBracketHex(inner)
      if (hex !== null) {
        out.color = hex
        return true
      }
      const len = parseBracketLength(inner)
      if (len !== null && typeof len === "number") {
        out.fontSize = len
        return true
      }
      return false
    }
    const named = token.slice(5)
    const color = named === "white" || named === "black" || /^[a-z]+-\d+$/.test(named) ? parseColorValue(named) : null
    if (color !== null) {
      out.color = color
      return true
    }
    const size = TEXT_SIZES[named]
    if (size !== undefined) {
      out.fontSize = size
      return true
    }
    return false
  }
  if (token.startsWith("font-")) {
    const w = FONT_WEIGHTS[token.slice(5)]
    if (w !== undefined) {
      out.fontWeight = w
      return true
    }
    return false
  }
  if (token.startsWith("opacity-")) {
    const n = Number.parseFloat(token.slice(8))
    if (/^\d+$/.test(token.slice(8)) && n >= 0 && n <= 100) {
      out.opacity = n / 100
      return true
    }
    return false
  }
  if (token.startsWith("rounded")) {
    const rest = token.slice(7)
    if (rest === "") {
      // Tailwind's bare `rounded` is 0.25rem = 4px (md is 6px — do NOT
      // conflate the default with the md step).
      out.borderRadius = 4
      return true
    }
    if (rest.startsWith("-[")) {
      const len = parseBracketLength(rest.slice(2, -1))
      if (len !== null && typeof len === "number") {
        out.borderRadius = len
        return true
      }
      return false
    }
    const r = RADII[rest.slice(1)]
    if (r !== undefined) {
      out.borderRadius = r
      return true
    }
    return false
  }
  // Length families are PREFIX+value tokens (p-4, min-w-2, gap-[7px]) or the
  // minus variant (-mt-2). Family lookup runs on the head before the first
  // dash; min-w/min-h carry their own dash so they are matched first.
  const FAMILIES: Readonly<Record<string, string>> = {
    ...SPACING_KEYS,
    gap: "gap",
    w: "width",
    h: "height",
    size: "size",
  }
  {
    let bare = token
    let negative = false
    if (bare.startsWith("-")) {
      negative = true
      bare = bare.slice(1)
    }
    let family: string | undefined
    let rawLen = ""
    if (bare.startsWith("min-w-") || bare.startsWith("min-h-")) {
      family = bare.slice(0, 5)
      rawLen = bare.slice(6)
    } else {
      const dash = bare.indexOf("-")
      const head = dash < 0 ? "" : bare.slice(0, dash)
      family = FAMILIES[head]
      if (family !== undefined) rawLen = dash < 0 ? "" : bare.slice(dash + 1)
    }
    if (family !== undefined && rawLen !== "") {
      // Tailwind semantics: only MARGINS take the negative prefix. A minus
      // on any other family is refused rather than producing a negative
      // padding/width the helper would have to guess about.
      if (negative && !(family.startsWith("margin") || family === "m")) return false
      const v = parseLength(rawLen)
      if (v === null) return false
      const wireKey =
        family === "min-w" ? "minWidth" : family === "min-h" ? "minHeight" : family
      out[wireKey] = typeof v === "number" && negative ? -v : v
      return true
    }
  }
  const layout = LAYOUT_TOKENS[token]
  if (layout !== undefined) {
    Object.assign(out, layout)
    return true
  }
  if (LAYOUT_NOOPS.has(token)) return true
  return false
}

export interface ParsedUtilities {
  /** Merged class-level base styles (later tokens win like source order). */
  readonly styles: StyleDict
  /** Tokens under `hover:` destined for the P1-c hover state layer. */
  readonly hoverStyles: StyleDict
  /** Tokens under `active:` destined for the P1-c active state layer. */
  readonly activeStyles: StyleDict
  /** Refused tokens (original spelling, variants included). */
  readonly unknown: readonly string[]
}

/**
 * Compile one class attribute value. Never throws: refused tokens come back
 * in `unknown` so callers own diagnostics policy.
 */
export function parseUtilities(input: string): ParsedUtilities {
  const styles: StyleDict = {}
  const hoverStyles: StyleDict = {}
  const activeStyles: StyleDict = {}
  const unknown: string[] = []
  for (const rawToken of input.split(/\s+/)) {
    if (rawToken === "") continue
    let target: StyleDict = styles
    let token = rawToken
    if (token.startsWith("hover:") || token.startsWith("active:")) {
      target = token.startsWith("hover:") ? hoverStyles : activeStyles
      token = token.slice(token.indexOf(":") + 1)
    }
    if (!parseSimple(token, target)) unknown.push(rawToken)
  }
  return { styles, hoverStyles, activeStyles, unknown }
}
