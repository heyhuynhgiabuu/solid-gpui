# P10 review brief (r2) — verification of the r1 fixes

## Context

Repo: solid-gpui. r1 (session mt9w8so2-89a5) verdict: NOT MERGEABLE —
1 Major (renderer client-side refusal not extended to svg/img; natural
misuse poisons the session) + 2 Minors (setSrc empty-string decode
asymmetry; svg without a color style renders nothing silently) + Notes
(img failure mode undocumented, image_cache deferral undocumented at code
site, demo used import.meta.dir). Commit under review now:
- c3b25a8 fix(helper): P10 r1 - client-side refusal for svg/img, decode parity, svg default tint

## What changed in c3b25a8 (verify against the diff)

1. Major fix: renderer.ts gains HELPER_OWNED_TAGS = {markdown, canvas,
   svg, img} + isHelperOwned predicate driving ALL refusal sites:
   insertNode child refusal, removeNodeImpl shadow-only cleanup, event
   listeners, state layers (now warns instead of silently dropping),
   dragData, keys, transitionMs animation guard. Canvas gains the prop
   guards it was missing since P8. Warnings name the actual tag.
2. Minor M2: retained.rs SetSrc apply rejects empty src with a typed
   message — mirrors the TS decoder exactly.
3. Minor M3: build_svg_element falls back to Hsla::default() (black,
   matching plain text) when neither base nor state styles carry "color";
   comment cites gpui's Option-based paint gate.
4. Notes: build_img_element doc documents the async broken-image failure
   mode (no setSrc-time validation: TOCTOU) and the deliberate absence of
   .image_cache(); demo resolves the asset via new URL(...).pathname.
5. New renderer test pins the whole refusal surface for svg/img misuse:
   no appendChild/setEventListener/setStyle-state/setDragData/
   setKeyBindings escape; warnings observable.

## What to check

- A. Every markdown-only guard is now helper-owned-scoped (grep renderer.ts
  for remaining tag === "markdown" — only the source-prop branch at ~496
  should remain, which is legitimately markdown-specific).
- B. The state-layer guard previously dropped SILENTLY for markdown and now
  WARNS for all four tags — confirm no test depended on silence.
- C. Rust empty-src rejection matches TS decode exactly (both reject "",
  both accept non-empty); retained media test still passes (its setSrc uses
  a non-empty path).
- D. The svg default-tint fallback cannot fight an animated color
  (effective_value path) — check ordering: default applied before style
  loop, loop overwrites when color present.
- E. Diff scope: nothing beyond these fixes rode along.

## Evidence you can run

- bun run test (166), bun run typecheck, cargo test both crates, clippy/fmt
  — by exit code.

## Verdict format

CLEAN, or remaining findings with path:line evidence naming check A–E.
IMPORTANT: your FINAL message must BE the verdict report — never end on an
intermediate step.
