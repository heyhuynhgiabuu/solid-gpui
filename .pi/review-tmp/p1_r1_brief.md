# P1 review brief (r1) — styling depth

## Context

Repo: solid-gpui. P1 is the first Phase 2 slice (roadmap in
.pi/artifacts/PLAN.md): styling depth = full CSS color formats, state-layer
styles (hoverStyle/activeStyle), shorthand expansion, margins/inset/shadow/
text props. Commits under review (contiguous):
- d43239c feat(helper): full CSS color formats in parse_color (P1-b)
- a7f74f7 feat(protocol): style-state layers hoverStyle/activeStyle (P1-c)
- 39f5d7f feat(solid): shorthand expansion + margins/inset/shadow/text props (P1-d/e)

Prior-art repo lxsmnsyc/solid-gpui: MIT, user-authorized for reference, but
this slice was designed from gpui's own API + our roadmap; flag anything
that looks lifted rather than derived.

## What changed (verify against diffs)

1. `crates/helper/src/host.rs` parse_color: rgb()/rgba()/hsl()/hsla()/named/
   transparent, case-insensitive, whitespace-tolerant. NEW parse_box_shadow
   ("x y blur [color]"). Tests in parse_color_tests (channel clamps, hue
   wrap, u8 quantization tolerance, rgb 4-field rejection).
2. Protocol (lockstep TS+Rust): setStyle gains optional closed-set `state`
   ("hover"|"active"; skip_serializing_if keeps base ops byte-identical —
   verify against batch-01 fixture round-trip tests still passing). Rust
   StyleState enum + Node.state_styles (BTreeMap, markdown rejects layers —
   validation/rendering agree). TS STYLE_STATES + decodeBatch rejects
   unknown states at mutations[i].state. Fixture batch-style-state-01.json
   parses+re-encodes byte-identical BOTH sides (round_trip.rs + batch.test).
3. Helper render: apply_state_styles inside apply_interactive (hover/active
   refinements on the Stateful<Div>; active() requires Stateful — this is
   the only place all interactive paths hold one). apply_style refactored
   GENERIC over gpui::Styled — one matcher table for Div + StyleRefinement
   (apply_refinement now delegates). New arms: padding sides, margins,
   inset sides, boxShadow, lineClamp (>=1 floor), whiteSpace, textOverflow
   ellipsis. CHECK: no Div-only method crept into the generic fn (overflow
   intentionally absent); unknown keys/values still ignored (open-key rule).
4. Renderer TS: hoverStyle/activeStyle props -> state-layered setStyle;
   markdown drops them pre-wire (would ack-fail + poison). NEW
   packages/solid/src/style-normalize.ts expandShorthands (pure): padding/
   paddingX/paddingY/margin/marginX/marginY/inset/size -> physical keys;
   wired into setProperty("style") and the layer path. Unknown keys pass.
5. StyleKey union (authoring surface) gains shorthand + physical keys +
   boxShadow/lineClamp/whiteSpace/textOverflow.
6. Tests: renderer.test.ts state-layer + shorthand describes (3+3);
   renderer-animation B2 expectation updated because padding is now a
   shorthand ON THE WIRE (physical keys emitted) — verify that reasoning;
   GUI smokes (stdio_window.rs): state-layer batch acks applied=5,
   shorthand+text-props batch acks applied=3. examples/counter.tsx demos
   shadow/nowrap/paddingX/hover.

## Invariants to actively check

- A. Cross-language contract: closed state set enforced BOTH sides with the
  SAME error taxonomy placement (decode-time TS invalidShape; Rust apply-time
  InvalidMutation for markdown layers — is that split consistent with how
  markdown children refusal works? Read retained.rs precedent).
- B. Base-wire compatibility: setStyle WITHOUT state is byte-identical to
  pre-P1 on both sides (old fixtures prove it — confirm no fixture churn
  was needed beyond new ones).
- C. Validation/rendering agreement: markdown state-layer rejection exists
  TS-renderer-side (drop) AND Rust-apply-side (error) — both directions of
  the same rule; also check no OTHER element type would silently drop a
  state layer (list wrapper path goes through apply_interactive? inputs?).
- D. Expansion purity + ordering: expandShorthands last-write-wins per
  physical key within one object; state layers expand independently of base.
- E. Generic apply_style: overflow still excluded (scroll handles are
  element-specific); no panic paths in new arms (lineClamp floor).
- F. TDD: the new tests fail without their implementations (mentally revert).

## Evidence you can run

- bun run test (119 expected; perf test is a known GUI flake under parallel
  load — rerun in isolation before counting a failure)
- bun run typecheck; cargo test -p solid-gpui-protocol -p solid-gpui-helper;
  cargo clippy --all-targets; cargo fmt --all -- --check
- bun run example/counter:tsx (GUI; hover the button, shadow under Count)

## Verdict format

CLEAN, or Blocker/Major/Minor with path:line evidence. Focus: protocol
lockstep, the generic-Styled refactor, and the markdown asymmetry.
