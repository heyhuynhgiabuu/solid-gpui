# Project Memory — gpuis (Solid + GPUI, clean-room)

## Landscape facts (verified 2026-08-24)

- gpuix (remorses/gpuix): 770★, no LICENSE (all rights reserved), ~12–16 npm downloads/week
  combined, macOS-only validated (Windows binding broken, issue #1), pins fork of zed.
- gpuix issue #10 (2026-08-23): third party added Svelte support in ~500 LOC, zero Rust
  changes, via `import { GpuixRenderer } from '@gpuix/native'` — proves adapter thinness.
- zed PR #63077 "gpui: Support embedding the macOS event loop" (by remorses, 2026-08-22):
  OPEN, unmerged, bot-review only. Adds `MacPlatform::new_embedded` + `pump_events`
  (1 file, +316/−31) for Node N-API hosts. Watch it; if merged, in-process backend gets cheap.
- gpui + platform subcrates (gpui_macos, gpui_apple, gpui_linux…) are Apache-2.0; crate
  `gpui` on crates.io is 0.2.2 (2025-10), 121k recent downloads — standalone momentum real.
- Zed repo has dual LICENSE-APACHE/LICENSE-GPL; editor parts GPL, gpui family Apache-2.0.
- Rich text/markdown/diff/syntax sources: port from Comet (github.com/zeronsh/comet, MIT)
  — legal to port with attribution (gpuix itself did this).
- Dead/quiet competitors: fzdwx/gpui-react (19★, dead), Alex6357/alloy Solid+QuickJS (70★, 1 day).

## Runtime facts (verified 2026-08-24)

- Solid: `latest` 1.9.15, `next` = 2.0.0-rc.1 (2026-08-19). Custom renderer story:
  `@solidjs/universal`, `createRenderer`, renderer-owned JSX types; API frozen at RC.
- Bun: `latest` 1.4.0 (2026-08-20, first all-Rust release). TSFN exit crash fixed 2026-08-21
  AFTER 1.4.0 (#39810 — wait for 1.4.1+); nested-loop TSFN deadlock open (#36828);
  no Fast Refresh in `--hot` (#40179) → hot reload = full remount pattern.
- gpuix side lessons (idea-level): batch mutations into ONE FFI/IPC call (`applyBatch`);
  fixed-rate tick pump on macOS ~125fps, never setImmediate-driven (73% vs 1% CPU idle);
  debug frame overlay painted native-side, not via framework.

## Project stance

- Clean-room vs gpuix: ideas only, no code/dep/fork-of-their-fork (ADR 001).
- **Decided 2026-08-24:** architecture = out-of-process helper + stock gpui, transport-agnostic
  protocol over UDS/stdio NDJSON (ADR 002); license = Apache-2.0 (ADR 003); name = **solid-gpui**,
  packages `@solid-gpui/{protocol,helper,solid}` (ADR 004). Spec FROZEN in PLAN.md.
- Local dir renamed to `solid-gpui` on 2026-08-24 (user action).
- Phase 1 = macOS-first walking skeleton; artifacts in .pi/artifacts/.

## Slice 1 learnings (2026-08-24)

- Wire contract pattern that works: one shared fixture JSON parsed by BOTH bun:test and cargo test — cross-language parity proven without transport. Keep for every protocol change.
- TS `keyof` on a string-index-signature type is `string | number` (numeric keys allowed) — bit the id-helper param typing.
- serde: enum-level `rename_all` renames VARIANT names only; variant fields need their own `#[serde(rename_all = "camelCase")]`. Internally tagged "op" + untagged StyleValue over serde_json::Number (preserves int repr, unlike f64).
- Bun 1.4.0 runs bun:test + JSON imports + TS zero-config; tsc strict + bun-types for typecheck.
- Rust edition 2024 let-chains satisfy clippy collapsible_if.
- Reviewer gotcha worth remembering: `x as u32` on a u64 silently truncates wire-reported
  values (v=4294967298 read as 2) — report the full width or reject; caught only by a test
  that literally could not compile against the truncated field type (compile-time RED).
- Consumer guidance from review: style-key values must stay string|number; __proto__-style
  keys are inert today, but widening value types would require Map/defineProperty copies.

## Slice 2 learnings (2026-08-24)

- gpui on zed main (Aug 2026): entry is `gpui_platform::application().run(|cx: &mut App|…)`
  (NOT crates.io 0.2.2's `Application::new()`). Deps: `gpui` + `gpui_platform` git;
  macOS feature `font-kit` (real glyphs; without it placeholder text system), Linux later
  `wayland`+`x11`. Window: `cx.open_window(WindowOptions{window_bounds:Some(WindowBounds::
  Windowed(bounds)),..Default::default()}, |_,cx| cx.new(|_| View))`. Quit: `cx.quit()` on App.
  Async: `cx.spawn(async move |cx| …)` with `cx.background_executor().timer(...)`.
- Cargo git deps auto-discover `gpui`/`gpui_platform` by name across the zed workspace;
  Cargo.lock pins the resolved commit — reproducible until we deliberately bump.
- **BLOCKER (env)**: macOS gpui build compiles `shaders.metal` via `xcrun metal`; CLT-only
  machines (this one, macOS 15.8) lack it AND lack `xcodebuild` to download the Metal
  toolchain component. Requires full Xcode + `sudo xcode-select -s`. No workaround.
- Parity contract pattern: Rust `#[ignore]`d generator test writes the snapshot fixture;
  Rust locks its own emission byte-exact; bun decodes the same snapshot. Rust→TS drift
  now caught by committed tests on both sides.
