# Tailwind-compatible utility subset

Gate 2 decision (ROADMAP option 1): a **documented Tailwind-compatible
subset**, not browser Tailwind. The `class` prop accepts utility classes that
compile client-side into the existing typed `StyleMap` and P1-c state layers.
There is no new wire surface — everything compiles into ops the helper already
validates. Anything outside this matrix is **refused with a diagnostic**
(`[solid-gpui] class "…" is not part of the supported utility subset`), never
half-applied and never silently dropped.

## Rules

- Canonical prop is `class` (Solid convention). `className` is **not**
  supported; using it warns and points here.
- Class styles sit **under** explicit `style` props: the same key in both
  means the `style` value wins.
- Compilation happens per element in the renderer; changing the `class`
  re-emits the full merged map (a helper-side setStyle replaces its whole
  map), so dropped utilities are actually removed helper-side.
- Values follow Tailwind's default scale: spacing is 4px per unit,
  `p-px` = 1px, `0.5` fractions allowed, `[10px]` / `[0.5rem]` / `[50%]`
  arbitrary brackets accepted where noted, negative margins via `-mt-2`.

## Supported matrix

| Family | Forms | Maps to |
| --- | --- | --- |
| Padding | `p-*` `px-*` `py-*` `pt-*` `pr-*` `pb-*` `pl-*` | `padding*` (shorthand-expanded to physical keys on the wire) |
| Margin | `m-*` family, negatives allowed | `margin*` |
| Sizing | `w-*` `h-*` `min-w-*` `min-h-*` `size-*` `gap-*` | `width` `height` `minWidth` `minHeight` `size` `gap`. The minus prefix is margins-only: `-p-4`/`-w-8` are refused (unknown), matching Tailwind where negative values exist only for margins/inset. |
| Layout | `flex` `flex-col` `items-center` `justify-center` `flex-1` `grow` `grow-0` `shrink` `shrink-0` `flex-row` (recognized no-op — row is the default) | `display` `flexDirection` `alignItems` `justifyContent` `flexGrow` `flexShrink` |
| Colors | `bg-{hue}-{shade}` `text-{hue}-{shade}` `bg-white/black` `text-white/black` `bg-[#hex]` `text-[#hex]` (full default Tailwind v3 palette, shades 50–950) | `backgroundColor` `color` |
| Typography | `text-{xs…9xl}` `text-[Npx]` `font-{thin…black}` | `fontSize` (px) `fontWeight` (numeric) |
| Effects | `opacity-{0…100}` `rounded{-none,sm,md,lg,xl,2xl,3xl,full}` `rounded-[Npx]` `cursor-pointer` | `opacity` `borderRadius` `cursor`. Bare `rounded` = 4px (Tailwind default); `rounded-md` = 6px. |
| Variants | `hover:*` `active:*` (any utility above) | state-layered `setStyle` (`hover` / `active`), identical to the `hoverStyle`/`activeStyle` props |

**Known deviations:** `flex-1` maps to `flexGrow`/`flexShrink` 1 without the
`flex-basis: 0%` third component (no wire key), so it sizes from content
before growing, unlike browser Tailwind. Arbitrary bracket values without a
unit (`gap-[7]`) are interpreted as px. The 4-digit `#rgba` hex shorthand is
refused rather than silently dropping its alpha digit (8-digit `#rrggbbaa`
passes through — the helper applies alpha via `rgba()`).

## Deliberately unsupported (each one warns)

- Responsive prefixes (`sm:` `md:` …), `group-*`, `focus:`, `dark:` — GPUI has
  no media queries or ancestor-variant machinery.
- Alignment values beyond `center` (`items-start/end/stretch/baseline`,
  `justify-between/around/evenly`), `grid`/table layout, `flex-row-reverse`,
  `flex-wrap` — the helper applies none of them today, so pretending would
  silently no-op.
- `overflow-hidden`, `shadow-*` classes (use the `boxShadow` style key),
  line-height utilities (no wire key), pseudo-elements, animations classes
  (use `transitionMs`/`transitionEasing` props), `truncate` (compose
  `whiteSpace`/`textOverflow` in `style`).
- Dynamic class values: `class` is a static string per element. Reactive
  styling belongs in the `style` prop (function form is reactive under `h()`;
  compiled JSX re-sends changed props naturally).

## Why a subset instead of "full Tailwind"

Full browser Tailwind assumes CSS cascade, units, and pseudo/media semantics
that do not exist in GPUI. This subset keeps the *authoring muscle memory*
(same scale, same palette hexes, same variant prefix) while every mapped
utility is verifiably applied by the helper — the matrix above is generated
from what `crates/helper/src/host.rs` actually implements, so the doc cannot
drift into advertising behavior the renderer drops.
