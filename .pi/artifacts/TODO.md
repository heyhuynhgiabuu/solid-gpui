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
status: active

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
- [~] VERIFY: bun 96/96 · tsc ×3 · cargo 7 suites (window 12/12; one
      macOS parallel flake re-verified green in isolation — known issue,
      MEMORY) · clippy · fmt · node smoke. Pending: reviewer round 2 on the
      fixes, user visual check of the demo.

Not in this session (later slices): syntax highlighting (tree-sitter), diff
(changes.rs), streaming (mend/veil), text selection.

Cross-ref: PLAN.md#2026-08-24---phase-2-candidate-roadmap-prior-art-informed
