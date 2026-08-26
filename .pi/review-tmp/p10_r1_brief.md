# P10 review brief (r1) — svg/img media + deferred/anchored overlays

## Context

Repo: solid-gpui. Commit under review:
- 6dfb695 feat(helper): svg/img media elements + deferred/anchored overlays (P10)

PLAN scope was anchored/deferred/img/svg/image-cache. After recon the slice
ships 4 of 5: image_cache SKIPPED (window image_cache_stack already caches
decoded frames — documented). Key recon facts driving design: gpui's
svg().data(bytes) renders without an AssetSource (hash-cached internally);
ImageAssetLoader handles Resource::Path via plain fs::read (file paths need
no asset source; URIs ride its http client).

## What changed (verify against the diff)

1. Protocol: ElementType Svg/Img join both closed sets. New mutations
   SetSrc {id, src} (img-only), SetDeferred {id, deferred} (universal),
   SetAnchored {id, anchor: Option<AnchorKind>} (universal; None clears);
   AnchorKind closed enum of 8 corners. setText allowlist gains Svg (the
   source IS text, like markdown). svg/img join no-child-slots AND all
   interactive-prop rejects (markdown/canvas pattern).
2. Helper: build_svg_element (svg().data(bytes), styles via generic applier
   incl. color tint); build_img_element (Uri vs Path split on scheme prefix,
   empty src renders empty div); apply_overlays wraps EVERY element after
   build_element_inner — anchored inside deferred so popover composition is
   deferred(anchored(child)).
3. Renderer: TAG_ELEMENT_TYPES gains svg/img; `src` prop routes by tag
   (svg→setText, img→setSrc); `deferred`/`anchor` props emit their
   mutations; unknown anchor warns+drops; ANCHOR_KINDS re-exported.
4. Tests: retained media test (store/replace/rejects/universal store+clear);
   round_trip fixture batch-media-01.json byte-identical Rust; TS parity +
   malformed-input rejections (null anchor legal); renderer routing tests;
   GUI smoke window_mode_media_elements_and_overlays_apply writes a real
   1x1 PNG to temp, renders svg from inline markup with color tint, img
   from that path, deferred lift, anchored wrap — ack applied=12.
5. Demo examples/media.tsx: icon grid retinted on click, disk PNG,
   anchored badge.

## Invariants to actively check

- A. Lockstep: both element closed sets; three new mutation ops in BOTH
  layers' name lists + decode; AnchorKind values identical strings.
- B. setText semantics: svg source via setText means markdown's "text is
  content" contract extends — confirm validation/rendering agree for svg
  (helper renders text as markup; wire rejects nothing else).
- C. Overlay ordering: anchored INSIDE deferred (popover shape) — verify in
  apply_overlays and reason about whether reversed order would break.
- D. build_element_inner refactor: confirm every former early-return branch
  now flows through apply_overlays (no branch returns before wrapping).
- E. img path handling: only http://|https:// prefixes route to Uri;
  everything else non-empty becomes a Path — including garbage paths, which
  fail asynchronously in gpui's loader (broken-image state, not a panic).
  Is silent-failure acceptable here vs setSrc-time path validation?
- F. GUI smoke asserts acks only; actual pixel output untestable headless.
- G. Demo asset examples/assets/media-sample.png committed (~13KB) — check
  size/licence sanity (generated gradient, fine).

## Evidence you can run

- bun run test (165), bun run typecheck
- cargo test -p solid-gpui-protocol -p solid-gpui-helper
- cargo clippy --all-targets, cargo fmt --all -- --check (exit codes!)
- Demo (GUI, optional): bun run example/media (~15s self-dispose)

## Verdict format

CLEAN, or Blocker/Major/Minor with path:line evidence naming the invariant.
IMPORTANT: your FINAL message must BE the verdict report — budget so it gets
written.
