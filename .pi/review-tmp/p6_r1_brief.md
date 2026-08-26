# P6 review brief (r1) — scrollbar overlay element

## Context

Repo: solid-gpui. P6 per roadmap: host-side scrollbar over any scrollable.
Recon found Zed's ui crate HAS a full scrollbar component (1722 LOC,
ScrollableHandle trait) but it depends on the theme crate — too heavy to
vendor; this is a minimal hand-rolled equivalent on the same pattern.
Single commit:
- 1270e36 feat(helper): scrollbar overlay element (P6)

## What changed (verify against the diff)

1. Protocol lockstep: ElementType::Scrollbar ("scrollbar") in BOTH closed
   sets (Rust ELEMENT_TYPES + enum; TS union + ELEMENT_TYPES). Fixture
   batch-scrollbar-01.json (BTreeMap key order height<overflow) round-trips
   byte-identical Rust-side; TS decodes via the shared ELEMENT_TYPES
   validation (no TS-specific test yet — CHECK this gap).
2. Retained validation (retained.rs attach): a Scrollbar accepts EXACTLY ONE
   child (second attach rejected "one bar, one target"); test in retained.rs
   (zero-child case exercises parent-missing order; one-child OK; second
   rejected).
3. Helper builder (host.rs build_scrollbar_element): wrapper div().relative();
   the CHILD renders through build_element (keeps its own overflow wiring)
   and fills the box; track div absolute right-0 top-0 width=thickness
   (style key, default 8); thumb when scrollable with pure
   scrollbar_thumb_geometry(handle, track_h, thumb_min) — proportional
   offset/max with min clamp (style thumbMinHeight, default 24); zero-max →
   full-height thumb at top (nothing to scroll). track_h from style
   "trackHeight" else window height (v1 limitation documented in code:
   ScrollHandle exposes no viewport()).
4. Drag pipeline: thumb mouse-down stores ThumbDrag (bar id, handle, pointer
   y at grab, track height at grab, target offset at grab) on HostView
   (pub(crate) field); window-level MouseMove + MouseUp listeners registered
   ONCE in the open_window callback in main.rs (on_mouse_event is PAINT-ONLY
   — cannot live in render(); this was hit and fixed during dev). Move
   handler: dy * (track+max)/track scale, clamp [0,max], set_offset, notify
   via Entity with explicit entity_id. Up handler clears state.
5. Tests: retained one-child contract; scrollbar_thumb_geometry unit
   (zero-max full thumb + 100/300 content math); GUI smoke wraps a 200px
   scrollable with 1200px inner div, scrollTo (existing command, SAME
   handle map) → result applied, getScrollOffset reads offsetY:150.

## Invariants to actively check

- A. Lockstep: "scrollbar" in both closed sets; fixture parses both sides
  (TS batch.test may lack a scrollbar parity test — the P4/P5 lesson says
  add one; verify and flag as Minor if missing).
- B. One-child contract honesty: does the renderer actually RENDER exactly
  one child (build uses children.first() — a second child is unreachable
  via wire, but confirm validation covers insertBefore re-parenting routes
  too, not just appendChild).
- C. Paint-phase discipline: the drag listeners registered in open_window's
  callback — confirm no remaining on_mouse_event call outside
  paint/construction phases; confirm the listeners don't leak per-window
  lifetime semantics (single window per helper).
- D. Geometry correctness: Pixels/Pixels = f32 ratio usage; zero-division
  guards (track<=0, max<=0, content<=0); thumb min clamp vs track min.
- E. Drag math: scale = (track+max)/track maps thumb px to content px;
  grab-point preservation (start_off captured at grab, not re-derived);
  clamping to max; offset sign convention (negative internal, positive wire).
- F. Back-compat: no changes to existing scroll paths (overflow wiring
  untouched); ScrollHandle map shared but get-or-create unchanged.

## Evidence you can run

- bun run test (147), bun run typecheck
- cargo test -p solid-gpui-protocol -p solid-gpui-helper (34 + 82 + 17 GUI)
- cargo clippy --all-targets (only pre-existing block v0.1.6), cargo fmt
- Targeted: cargo test -p solid-gpui-helper scrollbar; the GUI smoke name is
  window_mode_scrollbar_wraps_scrollable_and_acknowledges

## Verdict format

CLEAN, or Blocker/Major/Minor with path:line evidence. Focus: C (paint-
phase + listener lifetime), E (drag math + sign conventions), A/B.
