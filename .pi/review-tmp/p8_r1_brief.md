# P8 review brief (r1) — canvas element (recorded draw list)

## Context

Repo: solid-gpui. P8 per PLAN lesson 4: canvas = RECORDED draw list
(rect/path/text), replaced wholesale on every setDrawList; NO readback/
measure/transforms by design (GPU-side pixels). Single commit:
- 7d46918 feat(helper): canvas element with recorded draw lists (P8)

## What changed (verify against the diff)

1. Protocol lockstep: ElementType Canvas in both closed sets; DrawItem
   enum (serde tag "type", camelCase fields) — rect{x,y,w,h,color,
   cornerRadius?}, path{points flat [x,y,...],color,strokeWidth?,closed?},
   text{x,y,text,size,color}; Mutation::SetDrawList {id, items}. TS
   decodeDrawItem validates per-variant (shape, pair completeness,
   newline rejection mirroring Rust apply). Fixture batch-canvas-01.json:
   Rust to_json byte-exact; TS structural.
2. Retained contracts: setDrawList non-canvas → InvalidMutation; text item
   with \n → reject; odd points → reject; canvas joins the no-child-slots
   attach reject (text/input/textarea/markdown); canvas joins ALL 5
   markdown interactive-prop rejects (listeners/style-states/animation/
   keyBindings/dragData) with messages updated to "markdown/canvas".
3. Helper build_canvas_element: canvas(prepaint-noop, paint-replay);
   PaintQuad struct literal (Corners/Edges/BorderStyle defaults); PathBuilder
   fill (closed) vs stroke(strokeWidth.unwrap_or(1)); text via
   window.text_system().shape_line (WindowTextSystem, NOT App::text_system)
   + ShapedLine::paint; colors parse_color with magenta fallback; base
   styles applied via apply_style loop (Styled impl on Canvas).
4. Renderer: drawList prop (canvas-only, Array guard, warn+drop elsewhere);
   insertNode refuses children client-side for canvas (markdown pattern);
   TAG_ELEMENT_TYPES gains canvas AND scrollbar (scrollbar was a P6 gap —
   <scrollbar> JSX would have silently rendered a div).
5. Tests: retained (replace-wholesale, all rejects); round_trip fixture;
   renderer (verbatim items, warn+no-op); GUI smoke (full scene ack
   applied=4 through a real window + applyFailed error message exact-match);
   demo examples/canvas.tsx (live bar chart, self-disposes 6s).

## Invariants to actively check

- A. Lockstep: both closed element sets; decode validates EXACTLY what
  Rust apply enforces (newline, pairs) — validation and rendering agree.
- B. Replace semantics: second setDrawList replaces (test asserts ≠ first).
- C. Paint path: FnOnce closures are consumed per frame — our builder
  reconstructs the element every frame (like every other element); confirm
  no path caches a consumed Canvas.
- D. Style ordering: apply_style AFTER canvas construction — Canvas impls
  Styled; verify width/height actually size the element (demo relied on it).
- E. TAG_ELEMENT_TYPES: scrollbar addition is a behavior FIX — check it
  matches ElementType::Scrollbar wire value exactly.
- F. The magenta fallback: parse_color(None) on bad color — rendering must
  not panic; is silent-fallback acceptable vs reject-at-apply? (Note: TS
  decode does NOT validate color strings — Rust parse_color decides;
  flag if you consider that an invariant-1 violation worth fixing.)

## Evidence you can run

- bun run test (153), bun run typecheck
- cargo test -p solid-gpui-protocol -p solid-gpui-helper (34+34+32, 83+19 GUI)
- cargo clippy --all-targets (only pre-existing block v0.1.6), cargo fmt --all -- --check
- Targeted: cargo test -p solid-gpui-helper --test stdio_window canvas
- Demo (GUI): bun run example/canvas — live bar chart ~6s, clean exit

## Verdict format

CLEAN, or Blocker/Major/Minor with path:line evidence. Focus: A (TS/Rust
validation symmetry), D (Styled sizing), F (color policy).
