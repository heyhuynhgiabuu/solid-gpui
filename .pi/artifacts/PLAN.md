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

### 2026-08-25 - S13: rich text — markdown port from Comet (MIT)
status: active | input: Comet source read in full (parser.rs 1190, render.rs 1479, syntax, changes.rs skimmed)

Comet recon findings (verified path:line in ~/dev/scratch/comet-s13):
- Parser is standalone: pulldown-cmark 0.12 → BlockTree IR (Block::{Paragraph,
  Heading, CodeBlock{language,code}, BlockQuote, List{ordered_start,items},
  Table{header,rows,align}, Rule}; InlineRun{text, InlineStyle{bold,italic,
  code,strikethrough,link}}). No app coupling. Includes bare-URL autolink
  (pulldown lacks GFM autolink) + merge_runs canonicalization.
- Render maps BlockTree → gpui via StyledText/with_runs + InteractiveText
  (links) + canvas underlay (inline-code washes). Layout = constants (14/22
  body, 12.5/18 code, heading scale 19→14). Tables = flex columns with
  content-proportional widths (shape_line measures, Taffy resolves).
- NOT ported now (later slices or never): streaming (IncrementalParser/mend/
  veil — chat-specific), selection.rs, copy button (app state), syntax
  highlighting (tree-sitter ×25 grammars — heavy, separate slice), changes.rs
  diff (5248 LOC, `similar` crate — separate slice).
- Theme coupling is narrow: {font_sans, font_mono, text, text_muted, accent,
  border, code_text, code_wash} — stub with fixed defaults + element style
  keys (color/backgroundColor/fontSize) for slice 1.

S13 design (frozen for implementation):
- Protocol: elementType "markdown" (closed set, both languages, lockstep);
  content via setText on markdown elements (mirrors text); markdown has NO
  children (validation rejects attach — validation/rendering agree); setValue
  stays input/textarea-only. Fixture batch-markdown-01.json parsed by BOTH.
- Parsing+rendering live entirely Rust-side in crates/helper/src/markdown/
  (parser.rs + render.rs, Apache-2.0 header + "Ported from Comet (MIT,
  Copyright 2026 Wing)" attribution; THIRD_PARTY_NOTICES.md entry). One wire
  op per change — no per-block JS↔Rust traffic (ADR-002-friendly, same
  principle as setAnimation interpolating Rust-side).
- pulldown-cmark 0.12 = helper-only dep (Rust protocol crate stays
  wire-contract-only; TS protocol stays zero-dep).
- Solid API: h("markdown", { source: "# …" }) — renderer setProperty maps
  "source" → setText wire op. Children into markdown stay an apply error
  (honest contract, tested).
- Slices: S13a protocol+fixture parity → S13b parser port+tests (pure data)
  → S13c render port + window smoke + user visual → S13d demo + solid API.
  Syntax/diff/streaming = S13e+ (separate slices, not this session).

Cross-ref: TODO.md#2026-08-25---s13-rich-text--markdowncodediff-ported-from-comet-mit

### 2026-08-25 - Phase 2 roadmap: element/event surface expansion
status: research complete — slice ordering proposed, none started

Source studied: lxsmnsyc/solid-gpui docs (MIT; user re-authorized reference
2026-08-25). Read docs/{elements,events,commands,styling,protocol}.md + README
at architecture level. What follows is the gap analysis against OUR codebase
(crates/protocol/src/lib.rs ElementType: div,text,input,textarea,list,markdown;
EventType: click,mouseDown,mouseUp,mouseEnter,mouseLeave,keyDown,keyUp,focus,
blur,scroll,change,submit) and the slices I propose to close it. Designs will
be re-derived in our codebase; anything ported carries attribution.

#### Architectural lessons worth adopting (their hard-won constraints)

1. **Input buffers must live host-side.** IME/selection queries arrive
   synchronously during layout — a process round trip cannot answer them.
   Host owns buffer/caret/composition; JS sends `value`, host reports applied
   edits (so echoing value back does not fight the caret).
2. **Virtualized lists ask for rows DURING layout** — the answer cannot wait
   for a round trip. Host renders what it has, forwards the range request,
   next frame carries the rest (one frame of catch-up; margin hides it).
   Variable-height lists additionally need itemHeight stand-in,
   insertedAt height-cache continuity, align/follow for chat UX, and
   chunked (16-row) requests that REPLACE far requests instead of widening.
3. **Animations interpolate host-side** — a per-frame JS callback puts the
   process boundary inside the animation loop.
4. **Canvas is a RECORDED draw list** (quad/path/text), replaced not
   appended; no readback/measure/transforms (GPU-side pixels, sync
   impossibility).
5. **Scrollbars are host-implemented** — listener-based drag breaks the
   moment the pointer leaves the 8px track; needs sibling-wrap arrangement.
6. **Focus model**: focusable/tabIndex/autofocus elements get focus handles;
   key events on them are scoped, on non-focusable elements they fall back
   to window-level (root owns focus) — matches gpui natively. Shortcuts
   belong in a `keys` prop resolved through gpui's keymap, NOT onKeyDown.
7. **Style normalization belongs in JS** (shorthands, rem/% parsing, color
   formats) so the host does mechanical field assignment only.
8. **Element-valued props (tooltip) travel as node refs** — built on demand,
   never inserted into the tree.
9. **Batch = one line per Solid update** (microtask flush); after an event,
   flush Solid effects then queue → one round trip per interaction.
10. **Docs-per-topic + a mock host** (renders tree instead of drawing) for
    CI-friendly element tests; examples: counter + showcase.

#### Gap analysis → proposed Phase 2 slices (adoption-priority order)

| # | Slice | Why this order |
|---|-------|----------------|
| P1 | **Styling depth**: hoverStyle/activeStyle, group states, shorthands (paddingX/marginX/inset/size), rem/% + rgb()/hsl()/named colors, boxShadow, lineClamp/whiteSpace/textOverflow | Every app needs hover feedback + real CSS familiarity; pure JS-side normalization + style-keys we already forward-compat |
| P2 | **Input maturity**: host-side buffer verification (IME, selection, caret), onChange/onInput split (commit vs per-edit), multiline growth rules | We ship input/textarea today; correctness gap is invisible until CJK users hit it |
| P3 | **Focus + keys**: focusable/tabIndex/autofocus, scoped key events, `keys` prop via gpui keymap (sequences like "ctrl-x ctrl-s") | Shortcuts are table stakes for desktop apps; also fixes "every key listener hears everything" |
| P4 | **Window/dialog/shell commands**: appWindow.{setTitle,minimize,zoom,toggleFullscreen}, dialog.{message,openFile,saveFile}, shell.{revealPath,openWithSystem} | Our command channel (getStats/captureFrame) already exists — this is additive surface, high perceived value |
| P5 | **Variable-height list**: extend our uniform List with itemHeight/insertedAt/align/follow/overdraw + chunked onRange | We have uniform List; chat-log UX needs variable heights |
| P6 | **Scrollbars**: host-side bar wrapping any scrollable (uniform-list/list/div) | Lists feel broken without them on macOS |
| P7 | **Drag & drop + tooltips**: dragData/onDragStart/onDrop, dragOverStyle, tooltip (string or element-ref) | Standard desktop interactions |
| P8 | **Canvas**: recorded quad/path/text draw list | Unlocks charts; self-contained |
| P9 | **Menu bar (macOS)**: menu/item/separator with real shortcuts | Platform polish; macOS-only |
| P10 | **anchored/deferred/img/svg/image-cache**: overlay layers, image elements | Completes the element set |
| P11 | **span styled runs inside text**: color/weight/style/underline runs in one wrapping string | Complements markdown; needed for rich inline text |
| P12 | **Protocol compaction (positional arrays)** | Only if benchmarks show JSON-verbosity cost; their op encoding is ~3-5x smaller — measure first |

Perf note (their claim, unverified here): positional op arrays + one-line-
per-update keeps hundreds of ops per frame cheap. Our NDJSON objects are
larger; P12 parked until a benchmark justifies it.

Non-goals for Phase 2: streaming markdown (parked, revisit trigger stands),
multi-window (single-root protocol), in-process addon (ADR 002).
