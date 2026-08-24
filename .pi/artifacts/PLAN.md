# PLAN

### 2026-08-24 - Solid + GPUI OSS repo — spec (FROZEN 2026-08-24 after Q1–Q3)

status: frozen: 2026-08-24 | next: Phase 1 implementation (slices below)

## Identity

Repo: **solid-gpui** (license Apache-2.0, ADR 003). Workspace layout:

- `@solid-gpui/protocol` — TS types + (de)serializers for the mutation protocol; zero runtime deps
- `@solid-gpui/helper` — Rust binary crate (stock upstream gpui via git dep) owning its own main thread
- `@solid-gpui/solid` — Solid 2 renderer via `@solidjs/universal` + IPC transport + spawn/supervise of helper

## Goal

An Apache-2.0-licensed (ADR 003), Solid-first OSS repo that renders Solid 2 components into native
GPUI windows (no webview), runnable under Node.js and Bun, with a clean-room architecture:
idea-level inspiration from the prior-art bridge only; no the prior-art bridge code; no dependency on `@the prior-art bridge/*`.

## Non-goals

- No forking or copying the prior-art bridge source; no `@the prior-art bridge/native` / `@the prior-art bridge/react` dependency
- No React renderer in v1 (Solid-first; React may come later behind the same protocol)
- No Windows/Linux validation in Phase 1 (macOS-first; child-process model makes them cheap later)
- No markdown/code/diff custom elements until Phase 3 (port from Comet, MIT, with attribution)

## Acceptance criteria (Phase 1 — walking skeleton)

- [x] A Solid 2 (2.0.0-rc.x) app renders `div`/`text` with basic flexbox styles in a native window
- [x] Click event flows from GPUI back to a Solid handler
- [x] State change → minimal mutation (no full-tree diff) reaches the native layer
- [x] Works with `bun --hot` (remount without losing the window) and plain `node`
- [x] Counter demo committed with run instructions; `bun run example/counter` verified
- [ ] LICENSE file present; repo public-ready

## Resolved decisions (2026-08-24)

- Q1 architecture: **ADR 002 = option C** (out-of-process helper, transport-agnostic protocol)
- Q2 license: **ADR 003 = Apache-2.0**
- Q3 name: **solid-gpui** (rename local dir when session is closed: `mv ~/dev/projects/gpuis ~/dev/projects/solid-gpui`)
- Parked (non-decisions): IPC wire format v1 = newline-delimited JSON (binary framing deferred until measured); Windows/Linux validation (Phase 2+); React adapter (post-v1)

## Slices (Phase 1, order = risk-first)

1. Transport-agnostic mutation protocol (TS types + Rust trait, `applyBatch`-style batch op)
   — verify: `cargo test` round-trip of a batch — risk: protocol churn
2. Helper binary opens an empty GPUI window from stock upstream gpui (git dep, no fork)
   — verify: `cargo run --bin helper` shows a window — risk: gpui git-dep drift
3. JS↔helper IPC channel (stdio or UDS), spawn-from-package
   — verify: echo round-trip from Node and Bun — risk: Bun edge cases
4. Retained tree + `div`/`text` + minimal styles (flex, padding, color, size)
   — verify: protocol test renders golden tree dump — risk: style parser scope creep
5. Solid renderer via `@solidjs/universal` (`createRenderer`)
   — verify: unit test renders counter to protocol log — risk: RC API drift
6. Event backchannel (click) + `bun --hot` demo
   — verify: counter demo manual run + recorded session — risk: remount lifecycle

### 2026-08-24 - Phase 2+ candidate roadmap (prior-art-informed) — DRAFT, not frozen
status: FROZEN 2026-08-24 (user approved; order per recommendation) | input: public README of the unlicensed prior-art bridge (915★,
grew ~19% during Phase 1) — ideas learned, zero code/deps touched (clean-room,
ADR 001)

What their surface proves works, in the order they shipped it: core bridge →
hot-reload remount idempotency → click/hover events → native scrolling with
programmatic API → text input with IME/caret → focus & tab order → virtual
lists → markdown/code/diff native elements → Rust-driven animations → unstyled
headless controls (Radix-style namespaces) — PLUS two investments made early
that every later slice leaned on: a native frame-time debug overlay and a
frozen-clock automation/screenshot API with p95 perf regression tests.

Where our architecture differs (and why it changes the plan):
- Out-of-process helper (ADR 002): no fork to maintain, no ThreadsafeFunction,
  helper owns its event loop natively (immune to their 73%-CPU timer-tick bug).
  Distribution is EASIER too: ship a prebuilt binary per OS/arch (esbuild-style
  install script) instead of node-gyp addons.
- NDJSON stdio vs napi FFI: fine at UI scale, but anything per-frame (motion)
  must interpolate Rust-side with ONE op, never per-frame IPC.
- Solid first: fine-grained signals emit fewer mutations than React fiber;
  no abandoned-concurrent-work problem. DX gap: no JSX pipeline yet (h() only).
- Cross-language fixture tests already exist — rare; keep strengthening them.

Proposed slices (order = instrument first, then value):
- S7 Perf & visual-test instrumentation: debugFrameOverlay (draw-time stats
  painted Rust-side), perf regression harness asserting p95, frozen-clock
  captureFrames (helper writes PNG to a path given by an op) → CI-stable
  screenshots for every later slice.
- S8 Scrolling: overflow-scroll containers (gpui physics free), per-axis,
  programmatic scrollTo/scrollToItem/getScrollOffset ops; DOCUMENT nested-
  scroll hitbox limitation up front (their #1 gotcha).
- S9 Focus & keyboard: stable element id ↔ persistent FocusHandle map,
  tabIndex semantics, onKeyDown/KeyUp/Focus/Blur event types, Tab navigation
  resolved Rust-side (no IPC roundtrip), autoFocus + focusElement op.
- S10 Text input: <input>/<textarea> on gpui platform input handler (native
  caret/selection/IME/undo), controlled value sync both ways, onSubmit
  Enter/Shift+Enter, min/maxRows autosize.
- S11 Virtual list: retain-all/paint-visible, followTail chat mode,
  estimatedItemHeight remeasure, optional windowed mounting for huge sets.
- S12 Animations: single setAnimation op (target+transition), Rust-side
  interpolation, numeric targets only (width/height/insets/opacity/radius).
- S13 Rich text: markdown/code/diff ported from Comet (MIT, attribution) per
  existing Phase 3 decision.
- S14 Headless controls: select/combobox/tooltip primitive namespaces once
  inputs+focus are solid.
- Continuous: npm packaging w/ prebuilt-binary download script; JSX/babel
  universal preset DX track; Linux/Windows validation as upstream gpui allows;
  multi-window support.

Explicitly NOT copied: pinned gpui fork + submodule (we track upstream);
ThreadsafeFunction in-process bridge (ADR 002); per-frame JS frame loop.
