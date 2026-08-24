# TODO

### 2026-08-24 - Phase 0: architecture due diligence for Solid + GPUI OSS repo
status: done (2026-08-24 — Q1–Q3 decided, spec frozen; community probe moved to Phase 1 block)

- [x] Research gpuix repo (architecture, license gap, npm traction, fork burden) — prior session
- [x] Analyze fork embed patch (`MacPlatform::new_embedded` + `pump_events`, 1 file, +316/−31)
- [x] Verify upstream PR zed-industries/zed#63077 status: open, not merged, bot-review only, created 2026-08-22
- [x] Verify licensing: `gpui` + platform subcrates are Apache-2.0; Zed repo carries dual LICENSE-APACHE/LICENSE-GPL
- [x] User decision Q1: process architecture → **C: out-of-process helper** (ADR 002, 2026-08-24)
- [x] User decision Q2: repo license → **Apache-2.0** (ADR 003, 2026-08-24)
- [x] User decision Q3: repo name → **solid-gpui** (local dir `gpuis` still to be renamed by user; renaming under a live session breaks cwd)
- [x] Freeze Phase 1 spec + slices in PLAN.md after Q1–Q3 (spec frozen 2026-08-24)
- [ ] Community probe (r/solidjs, Solid Discord) — user action, parallel to Phase 1

### 2026-08-24 - Slice 5: Solid renderer (@solid-gpui/solid)
status: done (2026-08-24, commits 250e7e2 + review fixes b8e5c42)

Seam under test: `createSolidRenderer({ send })` — universal-renderer methods map to
protocol mutations; `send` injectable (RecordingSend in unit tests, real helper
connection in demo). JSX via automatic runtime through our jsx-runtime (no
babel-preset-solid in bun).

- [x] Verify solid-js 2.0.0-rc.1 universal API surface — createRenderer in
      @solidjs/universal (separate pkg now); solid-js main has no renderer;
      **critical discovery**: node/worker/deno conditions → SSR stubs, need
      --conditions=browser (upstream issue #2569)
- [x] RED: unit test — exact mount sequence + minimal-diff updates (5 tests,
      all failing on stub/absent renderer)
- [x] GREEN: renderer + flush (drains solid queue first) + own dispose
      lifecycle (universal dev-build render lacks cleanupNodes — shadow guard)
      + makeH hyperscript (JSX needs babel/vite — documented limitation)
- [x] Integration demo: real helper window renders Solid tree — **user saw the
      counter window** (Count: 0→3 fine-grained ticks, button color toggle)
- [x] VERIFY: commit 250e7e2; review mt6ywxoq→mt6z73l2-35e4 verdict
      findings-should-fix (1 critical: shadow dup entries on keyed moves;
      3 majors: send-failure loss, live conditions trap in root test,
      broken jsx-runtime export; minors/notes) — ALL fixed in b8e5c42 with
      regression tests (For-move+clear unique removals, poison policy,
      remount destroy, container tracking); README added; root test script
      browser-conditioned. Slice 5 CLOSED.

Cross-ref: PLAN.md#2026-08-24---solid--gpui-oss-repo-spec-frozen-2026-08-24-after-q1q3

### 2026-08-24 - Slice 4: retained tree + real GPUI rendering
status: done (2026-08-24, commits 35900a6 + 72d7059 + review fixes 9b57c55)

Seam under test: `RetainedTree` apply/validation (pure data, protocol crate,
no gpui) → helper `--stdio-window` mode (channels: stdin thread ↔ gpui main,
applied counts real, apply errors become seq-correlated error replies) →
style-subset mapping → gpui elements → e2e (GUI-gated) + demo script.

Part 4a (this commit):
- [x] RED: retained-tree unit tests (apply fixture, error semantics, cycles)
- [x] GREEN: `retained` module in protocol crate; cargo tests green (12/12)
- [x] VERIFY: full test suite + clippy/fmt; commit 35900a6

Part 4b:
- [x] Helper `--stdio-window`: stdin thread + channels + cx.spawn apply loop (72d7059)
- [x] Style subset mapping → gpui elements; repaint via cx.notify()
- [x] e2e GUI-gated (bun: fixture ack applied=12; correlated ReplyError test)
      (rust: stdio_window 1/1; bun client 7/7 window e2e included)
- [x] Demo script; user visual check — **user saw the fixture render 2026-08-24**
- [x] Independent review verdict — findings-should-fix: Major cycle hole +
      3 minors + notes; ALL fixed with regression tests in 9b57c55 (ancestor
      walk + MAX_DEPTH 256, root-clear on destroy, rgba() 8-digit colors,
      text-node children rejected, fmt, GUI gating, window-closed reply).
      Slice 4 CLOSED (commits 35900a6, 72d7059, 9b57c55).

Semantics decided (documented in retained.rs): child must be parentless on
append/insert (cycle-proof), removeChild keeps element alive for re-append,
destroyElement returns destroyed ids, setRoot replaceable (bun --hot remount),
setText requires text-type element.

Cross-ref: PLAN.md#2026-08-24---solid--gpui-oss-repo-spec-frozen-2026-08-24-after-q1q3

### 2026-08-24 - Slice 3: stdio NDJSON IPC (JS client ↔ helper)
status: done (2026-08-24, commits bf02123 + review fixes 89337fe)

Seam under test: real child process over stdio — helper `--stdio` mode
(NDJSON in → ack/error NDJSON out, no gpui/GUI), TS `@solid-gpui/client`
(spawn, per-seq correlation, supervision: pending-reject on exit), `Reply`
wire type added to the shared protocol (fixture-parity both sides).
Transport decision: stdio v1 (UDS deferred until measured) — announced to user.

- [x] RED: Rust stdio integration test (spawn binary, ack/error lines, EOF exit 0)
- [x] GREEN: protocol crate `Reply` + fixture parity; helper `--stdio` loop
- [x] RED: TS reply-decode test + client tests (module absent)
- [x] GREEN: `decodeReply` in protocol pkg; `@solid-gpui/client` implementation
- [x] Node compatibility smoke — NODE SMOKE OK under Node 24 (tsx + root tsconfig
      paths; bun workspaces emit no node_modules links; import.meta.dir avoided)
- [x] VERIFY: all tests (bun ×2 pkgs, cargo ×2 crates), typecheck, clippy, fmt;
      commit; independent review before closing

Run report (2026-08-24): RED observed all four stages. GREEN: bun protocol 20/20,
bun client 6/6 (real child), cargo 16 tests (incl. stdio integration), tsc ×2,
clippy clean, NODE SMOKE OK. Reviewer mt6wo1j7-380b verdict findings-should-fix:
Major 1 (spawn-failure crash/hang) + minors 2-7 + notes — ALL fixed in 89337fe with
regression tests under both runtimes; note-C missing tests partially covered
(in-flight kill, dup seq, spawn failure); ReplyError-branch e2e deferred to Slice 4
(helper cannot emit correlated errors yet, by design). Reviewer fact-check also
corrected two of my beliefs (see MEMORY).

Cross-ref: PLAN.md#2026-08-24---solid--gpui-oss-repo-spec-frozen-2026-08-24-after-q1q3

### 2026-08-24 - Slice 2: helper binary opens a GPUI window (stock upstream gpui)
status: done (2026-08-24, commits 31a97d2; user visual confirmation received)

Seam under test: committed Rust→TS cross-language parity (Rust `to_json` output
snapshotted in-repo and parsed by bun test) and helper smoke run
(`solid-gpui-helper --smoke <ms>` opens a window, draws, self-quits, exit 0).

- [x] RED: TS parity test fails (rust-emitted fixture absent) + Rust emission test fails
- [x] GREEN: generate rust-emitted snapshot from `to_json`; both sides pass (cargo 11/11, bun 15/15; commit 61f65f3)
- [x] Scout: current gpui API on zed main — done directly from upstream sources:
      `gpui_platform::application()` entry, macOS feature `font-kit`, examples
      hello_world.rs / on_window_close_quit.rs / window.rs (spawn syntax)
- [x] Helper crate: git dep gpui, `--smoke` mode — built clean after adding
      `move` to the run closure; Metal toolchain installed by user (commit 31a97d2)
- [x] VERIFY: `cargo test -p solid-gpui-helper` 2/2 green (smoke exit 0,
      ≥700ms elapsed), `cargo run -- --smoke 2000` exit 0 in 2.6s; clippy clean
      (zed-tree 'block' future-incompat warning only); fmt; commit 31a97d2.
      User visual confirmation of the window: **confirmed 2026-08-24**
      (window seen during `--smoke 2000` run). Slice 2 fully done.

Cross-ref: PLAN.md#2026-08-24---solid--gpui-oss-repo-spec-frozen-2026-08-24-after-q1q3

### 2026-08-24 - Slice 1: mutation protocol (TS + Rust) with shared fixture
status: done (2026-08-24, commit c73e89d)

Seam under test: `encodeBatch`/`decodeBatch` (TS, `@solid-gpui/protocol`) and
`from_json`/`to_json` + `MutationHandler` (Rust, `solid-gpui-protocol`), plus one shared
JSON fixture consumed by both languages (cross-language wire contract).

- [x] Scaffold: workspace roots, LICENSE (Apache-2.0), packages/protocol, crates/protocol
- [x] RED: TS tests (bun test) fail on stubbed encode/decode — 0 pass / 13 fail, stub throw observed
- [x] GREEN: TS decode/encode with typed ProtocolError (Result, no throw for recoverable) — 13/13 pass
- [x] RED: Rust tests (cargo test) fail on stubbed from_json — 0 pass / 8 fail, stub Err observed
- [x] GREEN: Rust serde types + pre-checks (unknownOp, version, eventType, id>=1) — 8/8 pass
- [x] VERIFY: bun test 13/13 + cargo test 10/10 + tsc noEmit OK + clippy clean; reviewer verdict **clean** (0 critical/major; 5 minors fixed or documented); commit c73e89d

Run report (2026-08-24): RED observed both languages on stubs; GREEN: bun 13/13,
cargo 8/8→10/10 after review fixes, tsc OK, clippy clean. Reviewer mt6udsof-f64a
verdict clean (empirical cross-language probes incl. serde byte-shape, __proto__,
bounds, dup keys); minors fixed: u64 version (no truncation), zero-id field paths,
NDJSON \n test live, dead branch removed; documented: serde error-path parity
deferred to Slice 2; note: JS number lossy >2^53 (doc'd in style.ts).

Cross-ref: PLAN.md#2026-08-24---solid--gpui-oss-repo-spec-frozen-2026-08-24-after-q1q3
