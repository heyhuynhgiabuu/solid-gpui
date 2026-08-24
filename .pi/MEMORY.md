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
