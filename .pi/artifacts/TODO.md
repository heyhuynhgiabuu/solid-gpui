# TODO

### 2026-08-24 - Phase 0: architecture due diligence for Solid + GPUI OSS repo
status: done (2026-08-24 — Q1–Q3 decided, spec frozen; community probe moved to Phase 1 block)

- [x] Research the prior-art bridge repo (architecture, license gap, npm traction, fork burden) — prior session
- [x] Analyze fork embed patch (`MacPlatform::new_embedded` + `pump_events`, 1 file, +316/−31)
- [x] Verify upstream PR zed-industries/zed#63077 status: open, not merged, bot-review only, created 2026-08-22
- [x] Verify licensing: `gpui` + platform subcrates are Apache-2.0; Zed repo carries dual LICENSE-APACHE/LICENSE-GPL
- [x] User decision Q1: process architecture → **C: out-of-process helper** (ADR 002, 2026-08-24)
- [x] User decision Q2: repo license → **Apache-2.0** (ADR 003, 2026-08-24)
- [x] User decision Q3: repo name → **solid-gpui** (local dir `gpuis` still to be renamed by user; renaming under a live session breaks cwd)
- [x] Freeze Phase 1 spec + slices in PLAN.md after Q1–Q3 (spec frozen 2026-08-24)
- [x] Community probe (r/solidjs, Solid Discord) — drafts written (casual
      tone, 3 variants) in .pi/artifacts/community-post-draft.md (27dc273);
      posting itself is the user's action. 2026-08-25.

### 2026-08-24 - Slice 6: event backchannel (GPUI clicks → Solid handlers)
status: Phase 1 CLOSED 2026-08-24 (reviewer: mergeable, 0 blocker/major).
Three reviewer minors fixed in a39c08f (handler-throw containment, SIGINT
hard-cap teardown, stale hot-reload handle). Public release DONE 2026-08-24: pushed to
https://github.com/heyhuynhgiabuu/solid-gpui , CI all green on first run
(ts on Linux; rust + node-smoke on macOS with GUI tests skipped).
ONLY remaining item in Phase 1 scope: community probe (user action).
Live --hot remount verified once (update(), same window); if the earlier
reload-kills-helper crash recurs, investigate bun --hot child-process
semantics. Independent review pending for ddd8860..8f7572f.

Seam under test: protocol `Event` wire type (fixture parity both sides) →
helper window mode attaches gpui on_click per retained listeners and emits
NDJSON events on stdout → client demultiplexes lines (reply vs event) and
routes to the renderer handler registry → Solid onClick actually fires.
Demo: counter button increments for real; bun --hot remount pattern.

- [x] RED: Rust event fixture parity + TS decodeEvent tests (absent)
- [x] GREEN: protocol Event type (Rust+TS); helper emits clicks via cx.listener
- [x] RED: client event-routing test (fake helper emitting an event line)
- [x] GREEN: client demultiplex (decodeReply ↔ decodeEvent) + onEvent callback
      wired into @solid-gpui/solid render() registry
- [x] Demo: user clicks increment the count in the GPUI window (USER confirmed
      2026-08-24 after fix ddd8860: public render() + auto-flush)
- [x] VERIFY: bun 41/41 (--conditions=browser) · tsc x3 · cargo 38 passed ·
      clippy clean · node smoke OK; commits 8ddf0e5 + deadlock fix 8154aed;
      independent review round 1 found stdout-lock blocker (fixed), round 2
      verdict: **Slice 6 mergeable**

Design notes: events are async server-push (not request/response) — separate
wire family from Reply; helper writes directly under the global stdout lock;
client tries decodeReply then decodeEvent per line. bun --hot remount works via
setRoot-replace semantics (previous root destroyed on second mount).

Cross-ref: PLAN.md#2026-08-24---solid--gpui-oss-repo-spec-frozen-2026-08-24-after-q1q3

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

### 2026-08-24 - S7: perf & visual-test instrumentation (Phase 2 opener)
status: active

- [x] S7a FrameStats (Rust): ring-buffer of build durations, p50/p90/p99/max,
      frames count; unit-tested (percentile math incl. wraparound/unsorted)
- [x] S7a Wire into HostView::render (measures build_element wall time);
      SOLID_GPUI_DEBUG_OVERLAY=1 paints stats block bottom-left via native
      gpui styling (no StyleValue protocol change); overlay run verified no-crash
- [x] S7b Wire command family: type field carries the command name
      ({"type":"getStats","seq":N} / {"type":"captureFrame","seq","path"});
      Reply gains Result{seq,value}; ReplyCode gains unsupported +
      unknownCommand; TS decodeCommand/encodeCommand + client sendCommand
      with seq correlation; fixtures parsed by BOTH languages (d1b3520)
- [x] S7b captureFrame {path} command: helper grabs own window by pid via
      xcap and writes PNG; verified end-to-end in stdio_window test
- [x] S7c bun perf harness: 200-row tree via render(), 30 paced updates,
      getStats over the wire; baseline p95 = 0.942ms vs 10ms budget (0986260)
- [x] VERIFY S7: 3 review rounds (r1 Major seq-union fixed, r2 tsc-gate
      lapse fixed, r3 mergeable); suites green

Review rounds: r1 Major (error routing) fixed 9266b9d; r2 caught broken tsc
gate (stale map generic) fixed b64f979 with visible-marker verification;
r3 verdict: **S7 mergeable**. Closed 2026-08-24.

Cross-ref: PLAN.md#2026-08-24---phase-2-candidate-roadmap-prior-art-informed

### 2026-08-24 - S8: scrolling (Phase 2)
status: active
Recon: upstream gpui HAS overflow scroll again — Styled::overflow_scroll /
overflow_x_scroll / overflow_y_scroll (div.rs ~1474), ScrollHandle +
track_scroll() for programmatic control, restrict_scroll_to_axis for their
nested-scroll gotcha. AGENTS.md gotcha text is stale (fixed same day).

- [x] S8a Style mapping: overflow accepts "scroll"|"scrollX"|"scrollY" —
      closed set in style.ts docs; parse_overflow is the single source of
      truth (60a9b8a)
- [x] S8a Handle lifecycle: per-element ScrollHandle map on HostView (Rc<RefCell>),
      get-or-create at render, pruned per frame for dropped ids (60a9b8a)
- [x] S8a Tests: parse_overflow unit tests (closed set + unknown) and
      window-mode smoke: 200px scroll container over 2000px child, ack 9/9
      (60a9b8a). Behavioral scroll proof lands in S8b via scrollTo commands.
- [x] S8b Commands: scrollTo {id,x,y} / getScrollOffset {id} -> Result;
      fixtures parsed by both suites; apply-time handle materialization fixes
      the pre-first-paint race; behavioral proof scrollTo(0,500) ->
      getScrollOffset {offsetX:0.0,offsetY:500.0} (6c28687)
- [x] VERIFY S8: suites green; commits 60a9b8a + 6c28687 + f088fb2; two
      review rounds — r1 found sign inversion (real scroll bug, clamped to
      0), masked test, clippy; all fixed in f088fb2 with old-code-fail
      regression proof; r2 verdict: **S8 mergeable**. Closed 2026-08-24.

Cross-ref: PLAN.md Phase 2 roadmap (S8 entry)

### 2026-08-24 - S9: focus & keyboard (Phase 2)
status: active
Recon: gpui FocusHandle has native tab_index (isize) + tab_stop (bool) fields;
focusable()/track_focus() on Stateful<Div>; cx.on_focus_in/on_focus_out per
handle (window.rs / app/context.rs); window.focus_next/focus_prev for Tab;
KeyDownEvent/KeyUpEvent carry keystroke.key:String + Modifiers. Event wire is
a single-variant enum (tag type:event) with optional x/y — extend with
optional key:String + modifiers{ctrl,alt,shift,cmd}; focus/blur need neither.

- [x] S9a Focusable core: tabIndex -> FocusHandle map (created via app focus
      map so Tab sees it); focus/blur events via cx.on_focus_in/out (deduped —
      per-frame re-registration emitted 3x duplicates); focusElement command;
      Event::Input gains optional key+modifiers (95828b6)
- [x] S9a Tests: event-keydown + focusElement fixtures both languages; window
      test focusElement(2)->focus, focusElement(3)->blur(2)+focus(3)
      (95828b6). Window tests serialized via global lock (parallel macOS
      windows flaked)
- [x] S9b Keyboard: keyDown/keyUp carry key+modifiers; handler registry passes
      full event to JS (DOM-callback contract, tested); Rust modifier mapping
      unit-tested byte-exact; wire covered by fixture (dee9e38)
- [x] S9c Tab navigation (per-focusable-element Tab -> focus_next/prev, no
      IPC; window.on_key_event panics in render — helper SIGABRT crash — so
      moved to element path); autoFocus focused next frame via defer_in
      (subscription-activation race); window test autoFocus->focus event
      (dee9e38). Tab cycling itself needs real input (no key injection in
      window tests)
- [x] VERIFY S9: suites green; commits 95828b6 + dee9e38; reviewer r1:
      **mergeable** (0 blocker/major). Minor follow-ups (non-blocking, tracked):
      focus_subscriptions never freed for long-lived sessions (bounded by
      distinct focusable ids); autoFocus on a node with no onFocus listener
      focuses but emits no event; window tests use fixed sleeps (acceptable,
      serialized by lock).
      Closed 2026-08-24.

Cross-ref: PLAN.md Phase 2 roadmap (S9 entry)

### 2026-08-24 - S10: text input (Phase 2)
status: active
Recon: gpui InputHandler trait (platform.rs ~1673) = the NSTextInputClient
surface: selected_text_range/marked_text_range/text_for_range/replace_text_in_range/
replace_and_mark_text_in_range/unmark_text/bounds_for_range (IME composing,
native caret/undo) — a view implements it and gpui routes native text input
to it. Needs a TextInput element (elementType "input"/"textarea") that the
focused input's InputHandler drives; value lives in the retained node and
crosses the wire on change (controlled value sync both ways).

- [x] S10a Protocol: elementType input/textarea (closed set both languages);
      setValue op (JS→helper controlled value; retained tree rejects it on
      non-inputs); EventType change+submit; Event.value (helper→JS change);
      simulateInput command (IME-path test seam + a11y hook) (b20eed5)
- [x] S10a Helper: InputState (value+caret+marked, UTF-16 code units) shared
      via Rc<RefCell>; ImeAnchor element registers gpui InputHandler in paint
      (window.handle_input is paint-only) so native IME/caret/undo edit the
      wire-driven state; change event + repaint per edit; inputs natural tab
      stops; Enter→submit (1556825)
- [x] S10a Tests: event-change + command-simulate-input fixtures both
      languages; UTF-16 unit tests (emoji=2 units); window test simulateInput
      → change {value} before result; window suite 7/7 × 5 runs (1556825)
- [x] S10b Textarea: multiline (flex-col, newline text), minRows/maxRows
      autosize (v1 = logical lines, no wrap-aware measure), Enter → newline,
      Shift+Enter → submit; input Enter → submit (1556825 + d70cd8e)
- [x] S10c Controlled sync: JS value→setValue overwrites helper state
      (caret to end — the controlled-input contract, unit+window tested);
      edits→change event→JS signal→setValue; no loop because Solid only
      re-sends setValue when the value prop actually changed. Demo input
      proves the round-trip live (d70cd8e)
- [x] VERIFY S10: r1 found 2 Majors (input/textarea children accepted while
      renderer drops them; encodeCommand mis-encoded simulateInput as
      getStats) — both fixed in 0d3d77e; r2: mergeable, 1 new Minor (TS
      suite didn't parse the simulateInput fixture) — added parity test
      (d8df9f5). Closed 2026-08-24.

Cross-ref: PLAN.md Phase 2 roadmap (S10 entry)

### 2026-08-24 - S11: virtual list (Phase 2)
status: active
Recon: gpui has UniformList (crates/gpui/src/elements/uniform_list.rs) — a
high-performance virtualized list WITH built-in follow-tail
(FollowState::Tail: auto-scroll when scrolled to bottom; stops following on
manual scroll up) and track_scroll integration. Item height is uniform
(pixel-estimated). This is the native building block for chat/tail lists.

Design sketch:
- [x] S11a Protocol: elementType "list" (children allowed — they ARE the
      items); style keys itemHeight (uniform height hint seeding unmeasured
      items) + followTail (chat mode); listInfo command {itemCount,
      paintedCount, atEnd} where paintedCount = items actually built last
      frame (virtualization proof). Fixtures batch-list-01.json +
      command-list-info.json parsed by BOTH suites (9ee5d9e).
- [x] S11a Helper: retained List node → gpui List (not UniformList — the
      fuller element: FollowMode::Tail + ListAlignment::Bottom + splice +
      remeasure) over the retained children (retain-all in the tree,
      paint-visible by the List, overdraw 500px). followTail → Bottom
      alignment + Tail armed ONCE (set_follow_mode resets scroll every call);
      alignment recreate on toggle; count reconcile via precise prefix/suffix
      splice (81b9d3b + 9d7362b); render_item re-enters the view via
      Entity::update so clicks/focus work inside items. Layout lesson: gpui
      divs default to BLOCK (child takes measured content height — List
      measured ALL items); wrapper must be flex ROW + definite pixel height.
- [x] S11a Tests: window test — 500 items + followTail → itemCount 500,
      atEnd true, paintedCount ≈63 < 200 (virtualization); append/remove
      reconcile + re-engage follow; followTail-toggle keeps items (c047c36);
      listInfo fixture parity both languages (81b9d3b).
- [x] S11b remeasure: content mutations (setText/setStyle/setValue) inside an
      item → remeasure_items(range) (gpui re-anchors scroll when the
      remeasured item is at the scroll top); pure list_item_containing() maps
      id→(list,item) unit-tested; window test exercises it. The List already
      measures real heights as items render — the hint only seeds off-screen
      items. No windowed mounting needed: gpui List virtualization suffices.
- [x] VERIFY S11: r1 = 3 findings (scroll reset on splice, tsc gate, non-root
      wrapper height) fixed in 9d7362b; r2 = 1 Major (list_children baseline
      not reset on followTail-toggle recreation → list emptied) fixed in
      c047c36; r3: mergeable. Closed 2026-08-24.

Cross-ref: PLAN.md Phase 2 roadmap (S11 entry)

### 2026-08-24 - S12: animations (Phase 2)
status: active
Recon: gpui has a first-class animation API (crates/gpui/src/elements/
animation.rs): `Animation::new(duration)` + `.with_easing(fn)` +
`AnimationExt::with_animation(id, anim, |el, t| ...)` — the animator receives
normalized time (eased, may overshoot) and rebuilds the element; the element
id preserves identity across frames. Springs (`with_spring`, SpringTarget)
preserve velocity across target changes — ideal for width/height/opacity
transitions (a chat list growing, a panel collapsing).

Design sketch:
- [x] S12a Protocol: Mutation::SetAnimation {id, target, transitionMs,
      easing?} — closed ANIMATABLE_STYLE_KEYS set (width/height/minWidth/
      minHeight/padding/gap/borderRadius/fontSize/flexGrow/flexShrink/
      opacity) + Easing enum (linear|easeIn|easeOut|easeInOut, default
      easeOut). TS decode = invalidShape; Rust retained apply =
      InvalidMutation (rejected on both sides). Target merged into the
      static style at apply time so the end state sticks without further
      traffic. Fixture batch-animation-01.json round-trips byte-identically
      in both suites (71d7389).
- [x] S12a Helper: ActiveAnimation (transitions + started + duration +
      easing) captured at APPLY time via prepare_animation (starts read
      BEFORE the merge destroys old values); render substitutes interpolated
      numbers in every build loop (div/input/textarea/list wrapper/items
      share a frame-start clock snapshot), request_animation_frame while
      any transition runs, entries dropped when complete/element
      gone/reduce-motion (17c7b06).
- [x] S12a Tests: fixture parity both suites; window test
      window_mode_animation_frames_flow_and_settle (frames climb >= +3
      during a 400ms transition, settle <= +1 after — observed RED with RAF
      disabled); easing endpoint/monotonic/midpoint-shape + lerp/clamp unit
      tests (17c7b06).
- [x] S12b continuity: resolve_start prefers the in-flight interpolated
      value (unit test: halfway 200->300 retarget starts at 250, not the
      merged 300); destroyed elements dropped by the render retain;
      reduce-motion drops entries (jump to end — static style already rests
      at the target) (17c7b06). Bonus S12c solid binding: transitionMs/
      transitionEasing props diff the style bag, changed numeric animatable
      keys emit setAnimation + companion setStyle omits them (4246191).
- [x] VERIFY S12: r1 (partial) exposed the h() eager-props gap -> reactive
      function style prop (c74efb6); r2 NOT MERGEABLE — B1 companion setStyle
      deleted numeric starts (poison on every animated change), B2 absent-
      prev keys animated, M1 second setAnimation dropped in-flight keys ->
      all fixed in 8930c2a; r3 verified fixes but timed out on a window
      flake -> root-caused (fresh ListState's first prepaint wipes height
      hints with no settle frame; poisoned lock cascade) and fixed in
      dcd25cb (settle frame, suite now 2x faster and stable 10x11/11); r4:
      MERGEABLE at dcd25cb. bun 85/85, tsc x3, cargo 93/93 (window 11/11),
      clippy, fmt. Closed 2026-08-25.

Cross-ref: PLAN.md Phase 2 roadmap (S12 entry)

### 2026-08-25 - S13: rich text — markdown/code/diff ported from Comet (MIT)
status: done (2026-08-25; markdown core complete. Syntax highlighting,
diff rendering, streaming = S13e+ future slices. USER confirmed the demo
works 2026-08-25 — window renders, swap + theme toggle operate as
intended.)

Phase 3 opener per PLAN roadmap order (S7–S12 closed). Legal source: Comet
(github.com/zeronsh/comet, MIT, Copyright 2026 Wing) — port with attribution
headers per ADR 001. User gave choice (rich text OR op-group/batching perf);
rich text is the PLAN-ordered slice, perf idea stays parked.

- [x] Recon Comet markdown subsystem (parser/render/syntax/diff) — PLAN.md
      S13 spec block has path:line-verified findings + frozen design
- [x] S13a protocol: elementType markdown + setText-on-markdown (validation
      both sides) + batch-markdown-01.json fixture parsed by BOTH suites
      (RED observed: TS decode fail + Rust compile fail → GREEN; commit 41b0837)
- [x] S13b helper: parser port (pulldown-cmark 0.12 → BlockTree; parse_full +
      autolink + merge only) with ported unit tests — pure data, no gpui
      (9/9 parser tests green; streaming machinery deliberately not ported)
- [x] S13c helper: render port (paragraph/headings/inline/code blocks/
      lists/blockquote/rule/table; links via InteractiveText; inline-code
      square washes; fixed MdTheme + color/backgroundColor/fontSize overrides)
      + window smoke test (mutation-observed RED, 3× stable; commit f002429)
- [x] S13d Solid API: h("markdown", {source}) → setText; children refused
      client-side (warn, no wire op); reactive function source in makeH;
      demo examples/markdown.ts mounts + swaps + theme-toggles (mounted
      verified; SIGINT teardown hang is pre-existing, affects counter too;
      user visual check pending). Commit f44d03d.
- [x] Review r1 (mt8dt6vq-068b): FINDINGS-SHOULD-FIX — 2 Majors + 3 Minors,
      ALL fixed with regression tests (RED observed via stash/mutation):
      M1 gpui id collisions (render ix schemes → pre-order Ids counter;
      table_cell_ix(top_ix) port regression → counter-allocated cell ids),
      M2 insertNode refusal (shadow bookkeeping + refusedChildren set;
      shadow-only removeNode; destroySubtree frees refused ids; sentinel/
      dispose/move-out tests RED→GREEN), m3 setEventListener/setAnimation
      rejected on markdown BOTH sides (retained.rs + client guards),
      m4 stale module doc, m5 TODO state, n6 per-frame comment honest.
- [x] VERIFY: bun 96/96 · tsc ×3 · cargo 7 suites (window 12/12) · clippy ·
      fmt · node smoke · demo mounts. Review r1 FINDINGS-SHOULD-FIX (2 Major
      + 3 Minor) all fixed in 679aa77 with RED-observed regression tests;
      review r2 (mt8eovd1-ddb1) verdict **CLEAN** — all 6 findings verified
      fixed, suites independently re-run green. r2 notes addressed: dead
      guard removed, move-out test strengthened to full op-list assert;
      Note 2 (mid-session detached nodes never destroyed — pre-existing,
      ALL element types, universal wrapper property) recorded in MEMORY as
      a future GC slice.

Not in this session (later slices): syntax highlighting (tree-sitter), diff
(changes.rs), streaming (mend/veil), text selection.

Cross-ref: PLAN.md#2026-08-24---phase-2-candidate-roadmap-prior-art-informed

### 2026-08-25 - S13e: code-block syntax highlighting (Comet crates/syntax port)
status: done (2026-08-25; r1 NOT MERGEABLE — language-keyed resolver Blocker
fixed content-keyed + span clamp; r2 verdict CLEAN, all suites independently
green. Diff rendering + streaming remain future slices.)

Port Comet's standalone syntax crate (tree-sitter based) into the helper,
wire into markdown code blocks. No protocol changes - highlighting is
entirely helper-side (fence tag already parsed into Block::CodeBlock).

- [x] S13e-a syntax.rs port: HighlightKind/precedence, normalize_line,
      from_absolute_spans, highlight_with_limits, alias/path/shebang tables;
      thiserror dropped (manual Display/Error); bundled grammar subset =
      rust/js/jsx/ts/tsx/python/go/json/jsonc/bash/toml/yaml/css/html
      (unbundled variants -> GrammarUnavailable -> plain-text fallback);
      Markdown-as-parent dropped; Html keeps injections. 12/12 ported tests.
      Grammar versions pinned EXACTLY like Comet (constant names differ
      between releases — caret deps broke the build once already).
- [x] S13e-b render: SyntaxPalette (zeron-dark) in MdTheme +
      runs_for_syntax_line; render_code_block consumes per-line spans;
      syntax_runs_recolor_without_changing_layout test pins exact-cover +
      single-font + recolor contract.
- [x] S13e-c host cache: per-element MarkdownCacheEntry {source, tree,
      highlights} compared by EXACT source text; kills the per-frame
      parse_full debt (n6) as a side effect; pruned per frame like other
      per-id maps; content-keyed resolver (identical fences share docs).
- [x] S13e-d demo: python + yaml fences added to DOC_B.
- [x] Review r1 (mt8gbici-7028): NOT MERGEABLE — Blocker fixed: resolver
      was LANGUAGE-keyed so two same-language fences with different code got
      the first fence's spans → over-length TextRuns → gpui panic (debug AND
      release). Fix: MarkdownCacheEntry::build/resolve CONTENT-keyed API +
      render passes (lang, code); defensive span clamp in runs_for_syntax_line;
      regression tests RED→GREEN. Minors: demo python/yaml fences actually
      added now (earlier script silently no-op'd — assert anchors!), notices
      extended for syntax.rs + builtins.rs palette, minified-lines perf test
      re-ported.
- [x] VERIFY: bun 96/96 · tsc ×3 · cargo all suites green · clippy · fmt ·
      node smoke. Review r2 (mt8grjo3-4bd4) verdict **CLEAN**: blocker fix
      verified end-to-end (resolver threading, clamp edges, cache lifecycle),
      minors/notes confirmed addressed; 3 non-blocking notes only. S13e
      CLOSED.

Cross-ref: TODO.md#2026-08-25---s13-rich-text--markdowncodediff-ported-from-comet-mit

### 2026-08-25 - S13f: ```diff fence rendering (Comet LineKind port)
status: done (2026-08-25; r1 FINDINGS-SHOULD-FIX both minors fixed; r2
verdict CLEAN with an empirical taffy reproduction of the scroll fix.
S13 rich text now fully closed: markdown core + syntax highlighting +
diff fences. Remaining future slices: streaming, full Changes pane.)

Lightweight completion of the original "markdown/code/diff" scope: pulldown
already yields CodeBlock{language:"diff"} - render those fences with per-
line kind coloring instead of tree-sitter. NOT the 5248-LOC Changes viewer
(that is app-coupled: rpc/comments/folds/watch streams).

- [x] S13f-a markdown/diff.rs: DiffLineKind::classify (Add/Del/Hunk/Meta/
      Context, prefix-only markers, +++/--- before +/-) + 2 test fns
- [x] S13f-b MdTheme diff palette (emerald-400 add / red-400 del / accent
      hunk text per upstream builtins) + render_code_block wiring: diff
      branch precedes syntax; full-bleed row washes via negative mx/px pair
- [x] S13f-c window test mounts a ```diff fence (ack+frames proof); demo
      DOC_B shows one
- [x] Review r1 (mt8hdejr-d712): FINDINGS-SHOULD-FIX, both minors fixed:
      (1) +++/--- space-gate so ADDED content like `+++i;` classifies Add
      not Meta (+ plumbing lines new file mode/Binary files/rename → Meta;
      header-shaped content documented as stateless limit); (2) wash rows
      use taffy default stretch instead of negative mx/px — scroll extent
      no longer inflated 2×padding; fence tag now case-insensitive;
      notices add changes.rs source.
- [x] VERIFY: bun 96/96 · tsc ×3 · cargo all suites green · clippy · fmt.
      Review r2 (mt8igv0v-05a7) verdict **CLEAN**: both minors verified
      fixed with code evidence + an empirical taffy 0.13 model (scroll_max
      24→0). S13f CLOSED.

Cross-ref: TODO.md#2026-08-25---s13-rich-text--markdowncodediff-ported-from-comet-mit

### 2026-08-25 - S15: JSX pipeline (universal preset track)
status: CLOSED 2026-08-25 (review r1 CLEAN; minor + coverage notes fixed)

Goal: author components in JSX (.tsx) against the existing renderer -
h() stays additive, no breaking changes. Success criterion:
examples/counter.tsx behaves identically to counter.ts.

- [x] S15-a recon: babel-preset-solid 2.0.0-rc.2 (wraps
      @dom-expressions/babel-plugin-jsx 0.50.0-next.44) `generate: "universal"`
      emits module-level imports (setProp, effect, createComponent, insert,
      insertNode, createElement, createTextNode + flow components) from
      moduleName; static props → createElement(tag, props), dynamic → two-arg
      effect(() => ({...}), ({...}, _p$) => ...) with prev-diffing. Universal
      rc.1 echoes a default two-arg effect that handles object-returning
      computes (verified empirically, .pi/effect-probe.ts, since deleted).
- [x] S15-b module-level runtime: packages/solid/src/jsx.ts (initJsxRuntime /
      resetJsxRuntime test seam, mountJsx app entry, bindings over the shared
      mount() from render.ts — seam NOT bypassed). 7 tests incl. numeric-text
      stringification and a compile-surface meta-test (babel-compiles a
      fixture, asserts every emitted import resolves to a jsx.ts export).
- [x] S15-c bun plugin: scripts/solid-jsx-preload.ts (Bun.plugin onLoad,
      .tsx → babel-preset-solid universal, moduleName @solid-gpui/solid/jsx);
      exports map entry "./jsx" in packages/solid/package.json; root devDep
      workspace link so examples resolve the specifier.
- [x] S15-d examples/counter.tsx (JSX twin of counter.ts: style objects,
      onClick/onMouseDown/onMouseUp, expression children) + script
      example/counter:tsx. User clicking verified live (events stream in
      log); two bug fixes fell out: renderer text coercion at the wire
      boundary (setText is a string op — {count()} passes raw numbers) and
      client seq-less error replies now reject the oldest pending instead
      of hanging flush forever (helper cannot echo a seq for a batch that
      never decoded).
- [x] VERIFY: gates + independent review — review r1 (mt8t1zyj-488d) verdict
      **CLEAN / mergeable**: invariants A–F all pass (reviewer independently
      re-ran bun test 104/104, typecheck, demo with real clicks, plus
      throwaway probes of compiled shapes / effect re-run safety / flow
      components). One Minor + two coverage Notes closed in a follow-up
      commit: replaceText update-path stringification now asserted
      (setN/setZ re-render), jsx.ts bindings pinned to void returns
      ([REACTIVITY_HALTED] guard for effect commits), and Show/For render
      through the suite committed as a test. Single-window JSX suite
      documented as accepted (h() remains multi-window). S15 CLOSED.

Cross-ref: TODO.md#2026-08-25---s13-rich-text--markdowncodediff-ported-from-comet-mit

### 2026-08-25 - S16: npm packaging + prebuilt-helper distribution
status: CLOSED 2026-08-25 (r1 NOT MERGEABLE, fixes in 497965d, r2 CLEAN)

Goal: `npm i @solid-gpui/solid` (or bun add) works in a fresh project with
no cargo toolchain. Helper binary ships in per-platform npm packages
(esbuild model) selected via optionalDependencies; no runtime downloads.
h()/JSX APIs unchanged.

- [x] S16-a ADR 005: per-platform npm packages + optionalDependencies over
      runtime download (esbuild/swc precedent; offline-friendly; no client
      fetch code); publish order platform → main; macOS arm64+x64 for 0.1.0
- [x] S16-b client binary resolution chain (env override → dev target/debug
      → platform package via require.resolve), TDD with fixture platform
      package; helpful error when no binary found
- [x] S16-c build + pack: tsdown dist builds (3 pkgs, per-package config,
      dts, ESM, workspace deps external); scripts/pack-package.mjs stages
      published manifests (exports→dist, workspace:*→version pin) because
      npm pack does not apply publishConfig; scripts/pack-helper.mjs
      assembles platform packages (os/cpu fields). E2E VERIFIED in
      ~/dev/scratch/s16-e2e-v4: npm install from local tarballs (overrides
      simulate registry), real Node 24 smoke (ack/exit), window demo with
      live click events — binary resolved via the platform package, no env,
      no target dir.
- [x] S16-d release.yml: helper matrix (darwin-arm64 macos-14 /
      darwin-x64 macos-13) → version check (check-release.mjs --tag) →
      build/pack → smoke with artifact binary → publish platform packages
      FIRST then TS packages (ADR 005 invariant), no-token path validates
      only. README gained an npm Install section; root scripts build /
      pack:all / check:release.
- [x] VERIFY: gates + independent review — r1 (mt8uho4p-b100) verdict
      **NOT MERGEABLE**: B1 release.yml could not auth npm publish
      (NODE_AUTH_TOKEN is read only via an .npmrc that setup-node's
      registry-url writes; npm itself never reads the env var) → added
      setup-node registry-url + secrets-context conditions; M1 dist/dist
      duplicate in every TS tarball — root cause: BSD cp -R nests the source
      dir into an existing destination under BOTH "dir" and "dir/."
      spellings (verified live) → replaced shell cp with Node fs.cpSync +
      rmSync-clean stage, tarballs re-audited flat, re-pack idempotent;
      M2 README falsely claimed Bun resolves solid-js correctly by default
      (measured: default conditions → server.js SSR stubs, 0 effect
      re-runs) → reworded to always pass --conditions=browser; m3
      pack-helper silently mapped unknown targets to x64 → whitelist with
      loud error. E2E re-run from fixed tarballs (v5): ack/exit OK.
      Awaiting r2 confirmation → r2 (mt8v4na1-1ec8) verdict CLEAN/mergeable:
      all four findings verified fixed with live evidence (tarball listings
      flat, pack idempotent, setup-node auth mechanism present, README claim
      gone, bogus target exit 2), invariants A/B/C re-confirmed. S16 CLOSED.
      Remaining user actions for a real release: push branch, add the publish
      credential in repo settings, tag v0.1.0.

Cross-ref: DECISIONS.md#adr-005

### 2026-08-25 - P1: styling depth (hoverStyle/activeStyle, shorthands, colors, text props)
status: CLOSED 2026-08-25 (r2: findings fixed, one stale-test Major fixed in d45dbd8)

Goal: styling reaches CSS-familiar depth per Phase 2 roadmap P1: state
styles (hover/active + group states if gpui supports), shorthand keys
(paddingX, margin*, inset, size, border* singles), full color formats
(rgb()/rgba()/hsl()/hsla()/named), text props (boxShadow, lineClamp,
whiteSpace, textOverflow). Wire protocol changes must keep the
cross-language contract discipline (TS+Rust lockstep, fixtures regenerated).

- [x] P1-a recon: current style surface both sides (style.ts keys,
      renderer setProperty, host.rs parse_color + style application) +
      pinned gpui capabilities (hover/active/group, shadow, line_clamp,
      whitespace, text_overflow) — cited path:line
- [x] P1-b colors: parse_color (host.rs) — rgb()/rgba() (0-255 + 0-1
      alpha), hsl()/hsla() (wrapping hue, % required), named subset +
      transparent, case-insensitive, whitespace-tolerant; commit d43239c
- [x] P1-c state styles: setStyle optional closed-set state field (TS+Rust
      lockstep, fixture batch-style-state-01.json both sides);
      Node.state_styles; markdown rejects layers (validation/rendering
      agree); helper layers via gpui hover()/active() refinements inside
      apply_interactive (active needs Stateful); renderer routes
      hoverStyle/activeStyle props, markdown drops pre-wire; GUI smoke
      acked applied=5; counter.tsx demos hover+active live; commit a7f74f7.
      Group states (group/groupHover) DEFERRED to a follow-up slice.
- [x] P1-d shorthands: packages/solid/src/style-normalize.ts
      expandShorthands (pure; padding/X/Y, margin/X/Y, inset, size →
      physical keys), wired into setProperty("style") AND state layers;
      unknown keys pass (open-key rule); wire carries physical keys only so
      Rust learns one set; StyleKey union gains both spellings; commit
      39f5d7f.
- [x] P1-e text/shadow props: helper arms for boxShadow ("x y blur
      [color]" via parse_color), lineClamp (floor 1), whiteSpace
      nowrap|normal, textOverflow ellipsis; margins/inset sides applied;
      apply_style refactored generic over Styled (refinements share the
      table; overflow excluded by design); GUI smoke applied=3; commit
      39f5d7f.
- [x] VERIFY: gates + independent review — r1 (mt8y1v7h-75ef) NOT CLEAN
      (M1/M2/M3 — fixed trong 81645d4 + 2b5cfd1); r2 (mt8yf9r5-afcf)
      verified cả ba findings FIXED (predicate test fail-pre-fix reasoning
      valid, animation test asserts physical-key setAnimation, TRBL mapping
      pinned, invariants A/B/C/E giữ nguyên) nhưng bắt 1 Major mới: suite đỏ
      ở HEAD do test numeric-start vẫn animate key "padding" đã rời khỏi
      animatable list. Fixed trong d45dbd8 (test đổi sang paddingTop —
      subject là numeric-start, không phải key). Gates sau fix: bun
      126/126 · tsc ×3 · cargo 68+29+30+14 · clippy · fmt · GUI smokes.
      P1 CLOSED.

### 2026-08-26 - P2: input maturity (IME/selection/caret, onInput/onChange, multiline growth)
status: CLOSED 2026-08-26 (r1 CLEAN — verdict đúng hướng: invariants A–F
đạt, gates xanh reviewer tự chạy; 4 Minor + 2 Note)

Goal: inputs behave like real text fields per Phase 2 roadmap P2. The
buffer/selection/caret must be verifiably host-side (IME queries arrive
synchronously during layout — round trips cannot answer them); onInput fires
per edit and onChange commits on blur/enter; multiline grows within
minRows..maxRows. Audit what exists first — v1 already ships input/textarea
with change events, setValue, placeholder, minRows/maxRows; this slice
closes correctness gaps found by adversarial typing tests.

- [x] P2-a recon: input core is MATURE — InputState (value/caret/marked,
      UTF-16 units, host.rs:62) + full InputHandler impl (text_for_range,
      replace_text_in_range, replace_and_mark (IME composing), unmark;
      host.rs:773-860) + edit_input event pipeline + Enter semantics +
      textarea autosize clamped minRows..maxRows (host.rs:1418-1435) + unit
      tests for emoji/clamping (host.rs:2335+). GAPS (with evidence):
      G1 onInput/onChange collapse — EVENT_NAMES maps BOTH to per-edit
      "change" (renderer.ts:39-52, comment admits it); no commit-on-blur.
      G2 set_selected_text_range unimplemented (trait default no-op,
      platform.rs trait list) → arrow keys/home/end/click cannot move the
      caret; InputState has no selection anchor so shift-select is absent.
      G3 paste unimplemented → Cmd+V dead on focused inputs.
      G4 (minor) autosize counts logical lines only (comment at 1424).
- [x] P2-b/c recon-driven scope: IME composing (replace_and_mark/unmark),
      UTF-16 surrogate handling, offset clamping ALREADY implemented +
      unit-tested (emoji tests at host.rs:2335+); adversarial gaps were
      G1-G3, fixed in this slice (commit above). Remaining manual check:
      live CJK typing in a window (user-side).
- [x] P2-c G1 event split (input per-edit / change commit-on-blur+Enter,
      dirty tracking, setValue clears), G2 selection anchor +
      set_selected_text_range + selection-aware replace, G3 paste — TDD
      units + GUI + TS coverage
- [x] P2-d recon verdict: autosize (minRows floor, maxRows cap, Enter →
      newline, Shift+Enter → submit) already implemented and GUI-covered;
      known limitation (logical lines, not wrapped) documented in code —
      reclassifying as a P5-class polish item, not this slice.
- [x] VERIFY: gates + independent review — r1 (mt8z3qsf-c971) verdict CLEAN:
      dirty lifecycle hoàn chỉnh (C: 3 mutation sites, mọi path qua
      edit_input/replace_and_mark), sink unification đúng phạm vi (D),
      lockstep A đạt, back-compat blast radius chỉ demo (B, đã fix
      cf42bdc). 4 Minors fixed trong 1238a1a: IME compose-over-selection
      asymmetry (M2), phantom anchor sau setValue (M3), 3 doc comments
      stale (M1), platform-range-ordering question documented (M4). Notes:
      emit_key vẫn bypass sink (pre-existing), controlled inputs không bao
      giờ emit change (deliberate, đã ghi nhận). P2 CLOSED.

### 2026-08-26 - P3: focus + keys (shortcuts via keymap, scoped key events)
status: CLOSED 2026-08-26 (r1-retry NOT MERGEABLE → fixes verified below)

Goal: desktop-app shortcuts work like desktop apps: a `keys` prop resolves
through gpui's keymap (sequences like "ctrl-x ctrl-s") instead of competing
with every onKeyDown; focusable/tabIndex scoping of key events verified.
Recon first — v1 already has tabIndex/autofocus/focus/blur/keyDown/keyUp.

- [x] P3-a recon: focus machinery đã trưởng thành (tab_index/tab_stop
      wiring host.rs:1392-1417, focus_in/out subscriptions + commit-on-blur,
      tab navigation Rust-side host.rs:1432-1443; keyDown chỉ đến element
      đang focus). gpui keymap LÀ action-dispatch tĩnh (bind_keys +
      Box<dyn Action>, platform.rs) — không hợp closure động kiểu JS → thiết
      kế thay thế: matcher chuỗi thuần trên listener keydown của element,
      scope nhờ focus (bindings làm element focusable).
- [x] P3-b protocol: setKeyBindings {id, bindings: Vec<String>} + EventType
      Keys (closed set cả hai phía, KNOWN_OPS/KNOWN_EVENT_TYPES đăng ký);
      Node.key_bindings; markdown reject apply-side; fixture
      batch-keys-01.json parse + re-encode byte-identical cả hai phía
- [x] P3-c helper: matcher thuần (canonical_keystroke/canonical_token/
      parse_binding/advance_binding — alias modifiers, sequence state
      machine reset-on-mismatch + fresh-match, stale-index an toàn khi
      bindings đổi giữa sequence); pending per-element trên HostView;
      bindings đọc lại từ tree lúc event; listener keydown scope theo focus
- [x] P3-d renderer: keys prop = { binding: fn } map → setKeyBindings +
      keys listener; keys handler demux theo binding báo về; re-set thay
      toàn bộ map; undefined clear cả hai; markdown warn + drop
- [x] VERIFY: gates + independent review — lần review đầu (mt9kifuw-f246)
      chết giữa chừng không verdict (29 tool calls, hết stream) → retry
      (mt9kqwri-49aa) với yêu cầu verdict là message cuối. Verdict NOT
      MERGEABLE: B1 keys-only element không bao giờ fire (outer gate có
      key_bindings, inner wants_focus KHÔNG → focusable() không chạy; smoke
      ack-only che mất), B2 panic seq.0[matched] khi bindings swap giữa
      sequence sang list ngắn hơn (guard chỉ che stale-bi), Major prefix
      shadowing im lặng (thứ tự list quyết định binding nào chết), Minor TS
      parity fixture keys thiếu. Tất cả fixed: hai gate sync kèm comment,
      stale-guard đầy đủ (reset + fresh-match), semantics pin bằng unit +
      renderer warn lúc cài, parity test thêm. Gates: bun 131/131 · cargo
      79+31+15 · tsc ×3 · clippy/fmt sạch. P3 CLOSED.

### 2026-08-26 - P4: window/dialog/shell commands
status: CLOSED 2026-08-26 (r1 NOT MERGEABLE → fixes in a50a335)

Goal: desktop-app surface per roadmap P4 — appWindow.{setTitle, minimize,
zoom, toggleFullscreen, activate}, dialog.{message, openFile, saveFile},
shell.{revealPath, openWithSystem} — over the EXISTING command channel
(getStats/captureFrame precedent: seq-correlated result replies, no new
mutation ops). API shape: imperative module functions taking the live
connection (render() handle exposes it).

- [x] P4-a recon: command channel = closed Command enum + seq + result
      replies (lib.rs:313, main.rs:289 dispatch pattern per-arm; async job
      loop cx.spawn nên await được). gpui: set_window_title (window.rs:2583),
      zoom/activate/minimize/toggle_fullscreen (5724-5751 vùng), prompt→
      Receiver<usize> (5751), App::prompt_for_paths/prompt_for_new_path
      (app.rs:1575/1588, PathPromptOptions files/directories/multiple/
      prompt platform.rs:2139), reveal_path/open_with_system (app.rs:1597-
      1603). macOS panels ASYNC (ConcreteBlock + oneshot, gpui_macos/
      platform.rs:777) — awaiting không block main thread. V1 surface:
      setTitle, windowAction{minimize|zoom|toggleFullscreen|activate},
      dialogMessage(level/message/detail/answers→answer index),
      dialogOpenFile(files/directories/multiple/prompt→paths|null),
      dialogSaveFile(directory/suggestedName→path|null), shellRevealPath,
      shellOpenPath.
- [x] P4-b protocol: 7 Command variants lockstep (setTitle, windowAction,
      dialogMessage/OpenFile/SaveFile, shellRevealPath/OpenPath) — Rust enum
      + closed-name matcher + error message list; TS union + WINDOW_ACTIONS/
      DIALOG_LEVELS closed sets + decodeCommand validation per type
- [x] P4-c helper dispatch: set_window_title/minimize/zoom/toggle_fullscreen/
      activate; dialogMessage qua window.prompt (PromptButton, answer index),
      dialogs qua AsyncApp::update → prompt_for_paths/prompt_for_new_path
      (NHỚ: AsyncApp::update trả R trực tiếp KHÔNG Result), reveal/open_with;
      dialogs async nên await không block main thread (macOS panel callbacks),
      strict ordering cho phép batch queue sau dialog — đúng semantics
- [x] P4-d TS API: packages/solid/src/desktop.ts (appWindow/dialog/shell,
      CommandChannel interface hẹp — interface segregation; seq namespace
      1_000_000+ disjoint với batch counter); RenderHandle sugar
      (handle.window/dialog/shell bound); 5 tests qua fake channel + mọi
      command round-trip decodeCommand (lockstep shape); README section
- [x] VERIFY: gates + independent review — r1 (mt9liwgo-b1c3) NOT MERGEABLE:
      B1 encodeCommand không có 7 branch mới — MỌI command P4 lên wire thành
      {type:getStats} (client là path duy nhất; test cũ dùng JSON.stringify
      nên không bao giờ đụng encoder — bài học encode/decode phải test ĐÔI);
      M1 serde enum-level rename_all không rename variant FIELDS →
      suggestedName bị drop im lặng (Option hấp thụ unknown key) + re-encode
      hiện null thừa → variant-level camelCase + skip_serializing_if toàn
      optional; m0 empty answers mở NSAlert không đóng được → throw ở API.
      Fixes a50a335: 8 encode regression tests (không fallthrough getStats),
      Rust round-trip pin camelCase CẢ HAI chiều. Pre-checks của tôi (D
      transport-mode Unsupported từ trước, C re-entrancy tuần tự job loop)
      được reviewer xác nhận. Gates: bun 144/144 · cargo 32+79+15 · clippy/
      fmt. P4 CLOSED.

### 2026-08-26 - P4 session note (artifact refresh)
status: done 2026-08-26 (superseded by the main P4 block — closed above; kept per no-delete rule)

- [x] P4-b protocol lockstep (7 commands) done; P4-c helper dispatch done
      (clean re-apply after a mangled layered edit; cargo 79+15 green)
- [x] P4-d: desktop.ts (appWindow/dialog/shell over connection) + RenderHandle
      sugar (handle.window/dialog/shell) + 5 fake-channel tests + decodeCommand
      round-trip pin + index exports + README section — all in 17b0b31, hardened
      in a50a335 (encode regressions, camelCase round-trips, empty-answers guard)
- [x] VERIFY: gates + independent review — r1 (mt9liwgo-b1c3) NOT MERGEABLE:
      B1 encodeCommand không có 7 branch mới — MỌI command P4 lên wire thành
      {type:getStats} (client là path duy nhất; test cũ dùng JSON.stringify
      nên không bao giờ đụng encoder — bài học encode/decode phải test ĐÔI);
      M1 serde enum-level rename_all không rename variant FIELDS →
      suggestedName bị drop im lặng (Option hấp thụ unknown key) + re-encode
      hiện null thừa → variant-level camelCase + skip_serializing_if toàn
      optional; m0 empty answers mở NSAlert không đóng được → throw ở API.
      Fixes a50a335: 8 encode regression tests (không fallthrough getStats),
      Rust round-trip pin camelCase CẢ HAI chiều. Pre-checks của tôi (D
      transport-mode Unsupported từ trước, C re-entrancy tuần tự job loop)
      được reviewer xác nhận. Gates: bun 144/144 · cargo 32+79+15 · clippy/
      fmt. P4 CLOSED.

### 2026-08-26 - P5: variable-height list (chat-log UX)
status: CLOSED 2026-08-26 (r1 Major → fixes verified below)

Goal: extend the existing uniform List toward gpui's variable-height list
semantics per roadmap P5: itemHeight stand-in for unmeasured rows,
insertedAt height-cache continuity on growth, align top|bottom, follow=tail
pinned until user scrolls, overdraw margin, chunked onRange requests that
REPLACE far requests instead of widening. Recon what v1 already has first
(uniform list + followTail + listInfo command exist).

- [x] P5-a recon: KIẾN TRÚC TA ĐÃ phủ phần lớn P5 — retained tree giữ TOÀN
      Bộ items helper-side (children của list), virtualization xảy ra
      helper-side trong render_item (host.rs:1830-1860) → KHÔNG cần onRange
      round-trip (đó là bài toán của kiến trúc JS-windowed prior-art).
      splice_range prefix/suffix diff (host.rs:1179) đã bảo toàn height-cache
      ngoài vùng đổi cho append VÀ prepend = insertedAt continuity tốt hơn
      heuristic prior-art. itemHeight đã là HINT semantics (gpui doc
      list.rs:341 — đo thật thay hint khi render). followTail→Bottom+Tail
      (host.rs:1821), FollowState tự stop khi user scroll (list.rs:574).
      listInfo command có sẵn. GAPS THẬT: (1) overdraw fixed px(500) không
      cấu hình được; (2) align ghì cứng vào followTail — không có align
      bottom-không-follow; (3) thiếu scrollToItem (gpui có scroll_to
      ListOffset list.rs:660). => P5 scope: overdraw + listAlign style keys
      (open set, không đổi protocol) + ScrollToItem command (lockstep đủ 3
      chỗ theo bài học P4: decode+encode+name list).
- [x] P5-b protocol: overdraw/listAlign là STYLE KEYS (open set — không
      cần protocol change, chỉ StyleKey union); ScrollToItem command lockstep
      ĐỦ 3 CHỖ mỗi phía theo bài học P4 (Rust enum+matcher+ident, TS union+
      KNOWN+decode+encode; encode test có sẵn "no getStats fallthrough")
- [x] P5-c helper: resolve_list_alignment (pure, 4 unit cases: default top,
      followTail→bottom back-compat, explicit wins cả 2 chiều, unknown value
      fallback) wired vào build_list_element; overdraw cấu hình được
      (default 500 = hành vi cũ) ở cả 2 nơi tạo state; scroll_list_to_item
      trên HostView (list_states private → method theo pattern list_info) +
      dispatch result-payload; height-cache-aware render + splice continuity
      ĐÃ CÓ từ trước (recon), onRange không cần (kiến trúc retained tree)
- [x] P5-d: list.ts (scrollToItem, seq namespace 2M riêng); StyleKey gains
      listAlign/overdraw; tests encode/decode đôi (protocol) + fake-channel
      (list API) + GUI smoke assert RESULT payload + correlated error path
- [x] VERIFY: gates + independent review — r1 (mt9mbrx0-25f6) NOT MERGEABLE:
      Major overdraw chết trên path chính — có BA nơi tạo ListState, site
      eager ensure_list_state (chạy TRƯỚC cho mọi list) vẫn hardcode
      px(500) + ternary cũ; followTail+overdraw bị ignore vĩnh viễn vì state
      tồn tại trước render, alignment không diverge → recreate không bao giờ
      chạy; GUI smoke pass may mắn vì listAlign của nó diverge. Reviewer
      khen scrollToItem lockstep "exemplary" (bài học P4 áp dụng đúng).
      Fix: list_state_config — MỘT nguồn sự thật cho cả 3 sites; regression
      unit pin đúng case reviewer nêu. Minors: doc/allow re-attach, list
      export + seq doc. Gates: bun 147/147 · cargo 81+32+16 · clippy/fmt.
      P5 CLOSED. Note 5 (followTail+listAlign:top mâu thuẫn — resolver thắng
      nhưng FollowMode vẫn armed): ghi nhận là hành vi cần doc ở P6; không
      đổi semantics trong slice này.

### 2026-08-26 - P6: scrollbars (host-side bar over any scrollable)
status: CLOSED 2026-08-26 (r1 2 Blockers → fixes 5df67ca → r2 CLEAN)

Goal: a <scrollbar> element wrapping a scrollable (div overflow, list) per
roadmap P6: bar drawn host-side (drag survives pointer leaving the 8px
track — listener-based drag cannot), works with pixel scrollables and
uniform lists (whole-row steps for variable lists documented as later).
Recon pinned gpui capabilities first (scrollbar exists upstream? Scrollbar
axis/drag/scroll_handle APIs) and our track_scroll/scroll handle plumbing.

- [x] P6-a recon: Zed ui crate CÓ scrollbar component (1722 LOC,
      components/scrollbar.rs, ScrollableHandle trait cho ScrollHandle +
      ListState) nhưng phụ thuộc theme crate — vendor quá nặng. Tự viết tối
      giản trên pattern tương tự. ScrollHandle có offset/max_offset/
      set_offset (div.rs:4063-4068,4199) nhưng KHÔNG viewport() → track
      height từ style key trackHeight / window height fallback (v1 hạn chế
      documented). Quyết định: elementType "scrollbar" MỚI (closed set, mở
      bằng lockstep) wrap MỘT scrollable (protocol enforce).
- [x] P6-b: ElementType::Scrollbar cả hai phía + retained attach validation
      (đúng MỘT child — cái hai bị reject "one bar, one target"); fixture
      batch-scrollbar-01.json BTreeMap-sorted; builder: wrapper .relative(),
      child giữ overflow wiring riêng, track absolute phải phải, thumb theo
      scrollbar_thumb_geometry (pure: proportional + min clamp, đơn vị
      Pixels/Pixels=f32); drag: state ThumbDrag trên HostView, mouse-down
      thumb ghi grab point, window-level listeners ĐĂNG KÝ MỘT LẦN trong
      open_window callback (on_mouse_event là PAINT-ONLY — render() không
      được), scale thumb→content = (track+max)/track
- [x] P6-c: GUI smoke — scrollbar wrap + scrollTo qua CÙNG handle map +
      getScrollOffset đọc lại offsetY:150 (bài học: content scrollable phải
      là div height cố định chứa div tall, KHÔNG phải text mang style height;
      và sleep một frame sau ack trước khi scroll để max_offset materialize);
      thumb geometry unit; fixture round-trip byte-identical. Track-click
      jump + list target (ListState) = follow-up khi có nhu cầu thật
- [x] VERIFY: gates + independent review — r1 (mt9n6bj0-bc25) NOT MERGEABLE,
      2 Blocker cùng root cause: window.on_mouse_event là PAINT-ONLY **và**
      listener sống đúng 1 frame (Frame::clear drop) — đăng ký open_window
      callback vừa panic debug_assert (smoke suite ĐỎ) vừa vắng trong
      --stdio-window (mode client thật) vừa chết sau frame 2. Tôi sai 2 lần
      (render() cũng không phải paint phase). Fix đúng pattern gpui:
      ScrollDragAnchor — element zero-size trong scrollbar wrapper, paint()
      đăng ký MỤI frame (tiền lệ ImeAnchor). M2: comment chối API sai —
      ScrollHandle::bounds() TỒN TẠI (div.rs:4111), track height giờ đọc
      bounds sống. M1: TS parity fixture scrollbar. r2 (mt9od7w6-bc6b)
      verdict CLEAN — audit từng change + smoke exit 0 + grep không còn
      on_mouse_event ngoài anchor paint. Gates: bun 148/148 · cargo
      34+82+17 (smoke xanh lại) · clippy/fmt. P6 CLOSED.
