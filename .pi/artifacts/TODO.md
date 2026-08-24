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

### 2026-08-24 - Slice 2: helper binary opens a GPUI window (stock upstream gpui)
status: active

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
