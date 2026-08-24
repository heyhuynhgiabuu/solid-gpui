# Project Memory — gpuis (Solid + GPUI, clean-room)

## Landscape facts (verified 2026-08-24)

- Prior art "the unlicensed bridge" (do not name in public docs): 770★, NO LICENSE (all rights reserved), ~12–16 npm downloads/week
  combined, macOS-only validated (Windows binding broken, issue #1), pins fork of zed.
- Upstream issue #10 (2026-08-23): third party added Svelte support in ~500 LOC, zero Rust
  changes, importing only the native package's renderer class — proves adapter thinness.
- zed PR #63077 "gpui: Support embedding the macOS event loop" (by remorses, 2026-08-22):
  OPEN, unmerged, bot-review only. Adds `MacPlatform::new_embedded` + `pump_events`
  (1 file, +316/−31) for Node N-API hosts. Watch it; if merged, in-process backend gets cheap.
- gpui + platform subcrates (gpui_macos, gpui_apple, gpui_linux…) are Apache-2.0; crate
  `gpui` on crates.io is 0.2.2 (2025-10), 121k recent downloads — standalone momentum real.
- Zed repo has dual LICENSE-APACHE/LICENSE-GPL; editor parts GPL, gpui family Apache-2.0.
- Rich text/markdown/diff/syntax sources: port from Comet (github.com/zeronsh/comet, MIT)
  — legal to port with attribution.
- Dead/quiet competitors: fzdwx/gpui-react (19★, dead), Alex6357/alloy Solid+QuickJS (70★, 1 day).

## Runtime facts (verified 2026-08-24)

- Solid: `latest` 1.9.15, `next` = 2.0.0-rc.1 (2026-08-19). Custom renderer story:
  `@solidjs/universal`, `createRenderer`, renderer-owned JSX types; API frozen at RC.
- Bun: `latest` 1.4.0 (2026-08-20, first all-Rust release). TSFN exit crash fixed 2026-08-21
  AFTER 1.4.0 (#39810 — wait for 1.4.1+); nested-loop TSFN deadlock open (#36828);
  no Fast Refresh in `--hot` (#40179) → hot reload = full remount pattern.
- Prior-art lessons (idea-level): batch mutations into ONE FFI/IPC call;
  fixed-rate tick pump on macOS ~125fps, never setImmediate-driven (73% vs 1% CPU idle);
  debug frame overlay painted native-side, not via framework.

## Project stance

- Clean-room vs prior art: ideas only — no code/dep/fork-of-their-fork (ADR 001);
  do not name the prior art project in public docs (user request 2026-08-24).
- **Decided 2026-08-24:** architecture = out-of-process helper + stock gpui, transport-agnostic
  protocol over UDS/stdio NDJSON (ADR 002); license = Apache-2.0 (ADR 003); name = **solid-gpui**,
  packages `@solid-gpui/{protocol,helper,solid}` (ADR 004). Spec FROZEN in PLAN.md.
- Local dir renamed to `solid-gpui` on 2026-08-24 (user action).
- Phase 1 = macOS-first walking skeleton; artifacts in .pi/artifacts/.

## Slice 6 learnings (2026-08-24)

- DEADLOCK INVARIANT (cost us one review round): never hold the process-global
  stdout lock across a blocking read. The stdin thread and the GPUI main thread
  (emit_click) share std stdout; the lock must be scoped per write. See the
  comment at run_stdio_window in crates/helper/src/main.rs.
- gpui interactive elements: `.id()` comes from InteractiveElement, `.on_click`
  from StatefulInteractiveElement (needs Stateful<Div>); `Pixels` field is
  private — use `.to_f64()`. `cx.listener` is how a render-time closure reaches
  view state.
- serde f64 40.0 serializes as "40.0" — committed fixtures must use the
  canonical form or Rust byte-equality tests fail while TS parses fine.
- Events are async server-push: NOT seq-correlated like replies; client demuxes
  per line by trying decodeReply then decodeEvent.
- render() in packages/solid/src/render.ts is the ONLY path that wires
  event→handler routing; bypassing it (demo did) silently kills clicks.
  Post-handler flush is render()'s job — flush() pumps Solid's scheduler
  until the queue settles, safe to call right after a sync handler.
- BYPASSED-SEAM BUG (bit us TWICE in slice 6): anything that wires
  spawnHelper/createSolidRenderer by hand has NO event routing and NO
  auto-flush. render() in packages/solid/src/render.ts is the only wired
  entry point; examples must use it (RenderHandle.update for remounts), and
  code review should reject hand-rolled wiring outside render.ts.
- handle.update() must dispose the previous Solid tree BEFORE mounting the
  new one: zombie effects from the replaced tree touch destroyed nodes
  (replaceText(undefined)); disposer also emits destroyElement + clears
  handler registry.
- Write-tool slip twice this slice: full-file content landed on the wrong
  sibling path (index.ts, then render.test.ts). Always re-read after writes.
- TS narrowing trap: `(EVENT_TYPES as string[]).includes(v)` does NOT narrow;
  write an explicit `v is EventType` predicate.

## S9 focus/keyboard gotchas (all caught live during implementation)
- gpui `Window::on_key_event` must be called during the PAINT phase, not
  render() — calling it in render() panics ("this method can only be called
  during paint") and a panicking GUI process aborts (SIGABRT crash report).
  Handle global keys per-element instead (keys only reach the focused
  element anyway).
- `cx.on_focus_in/out` subscriptions ACTIVATE ONE FRAME LATE (gpui defers
  activation). Focus issued before that (e.g. autoFocus at apply time) is
  silently missed. Fix: defer the focus via cx.defer_in so it runs after the
  subscription activation in the same defer queue.
- Per-frame render re-registration accumulates: focus subscriptions must be
  deduped by element id (observed 3x duplicate focus events). window.on_key_event
  is the exception — it registers on the next-frame dispatch tree, so it does
  NOT accumulate.
- macOS window tests flake under the default parallel harness: several real
  windows at once push first-frame latency past poll budgets. Serialize with
  a process-global Mutex inside the test binary.
- FocusHandle has NO Default impl: create via the app focus map (cx.focus_handle(),
  Context derefs to App) so Tab navigation (window.focus_next/prev) sees it.

## gpui scroll sign convention (S8 review round 1 — reviewer caught a REAL bug)
- gpui `ScrollHandle::set_offset` uses the OPPOSITE sign of CSS scrollTop:
  offset = distance from container top-left to first child top-left, growing
  NEGATIVE as you scroll down; layout clamps to [-max, 0] (div.rs ~2364).
- Wire must stay non-negative-positive-down (CSS-like); negate on the way in
  and on the way out, and clamp reads against max_offset for honesty.
- Reviewer lesson: a test reading the RAW handle state can mask a broken
  scroll while passing. Behavior tests must assert what the USER sees (the
  clamped visible position), not the internal request.
- Verification lesson (again): never grep clippy output with a narrow
  pattern like "warning: use of" — it misses whole lint families. Run
  `cargo clippy --all-targets -- -D warnings` and check the exit, or grep
  broad "^warning:|^error:" and read every line.

## Verification discipline (learned the hard way, S7 review round 2)

- NEVER pipe a gate's output to /dev/null and trust `&& echo MARKER` from
  memory of past runs — the marker line must appear in captured output you
  actually read before claiming success. A reviewer caught "tsc OK" claimed
  while typecheck was failing silently (stale map generic).
- Bun tests passing does NOT imply tsc passes: bun strips types at runtime.
  The two gates fail on different file sets; run both visibly.

## Phase 1 closeout (2026-08-24)

- Public repo: https://github.com/heyhuynhgiabuu/solid-gpui — CI green first
  run: ts job on ubuntu (typecheck+bun suites); rust & node-smoke on macos-14
  with SOLID_GPUI_SKIP_GUI_TESTS=1; clippy -D warnings clean.
- SIGINT harness gotcha: `kill -INT` at a bash compound-command PID does NOT
  reach bun (background jobs inherit SIG_IGN) — signal the bun child pid
  directly or you will misread teardown as hanging.
- screencapture/clipboard reads are blocked from the agent sandbox; visual
  verification must go through the user (probe scripts beat screenshots).

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

## Slice 3 learnings (2026-08-24)

- Bun 1.4.0 spawn() with ENOENT behaves like Node: async 'error' event, no sync throw
  (my earlier belief + part of reviewer's report were outdated). Supervision must listen
  to BOTH 'error' (spawn failure, 'close' never fires) and 'close' (not 'exit' — stdio
  drains first, so a final flushed ack is processed before pending rejection).
- CORRECTION (reviewer-verified): bun workspaces DO create nested node_modules symlinks
  (packages/client/node_modules/@solid-gpui/protocol). Root tsconfig paths are only for
  scripts/ + tsx bare-import resolution; packages' tsc resolves via the symlink.
- Publish-time concern noted: exports→.ts needs a loader for plain-Node consumers.
- Rust stdin lines(): invalid UTF-8 yields Err — answer decodeFailed then break, never
  silent exit-0 (indistinguishable from EOF).
- Compact JSON fixtures for wire tests via to_json(from_json(...)), never whitespace
  stripping (corrupts UTF-8 string contents).
- in-flight promise hygiene: duplicate-seq guard + write-then-set ordering (a throwing
  sync write must not leak a pending entry).

## Slice 5 learnings (2026-08-24)

- **THE trap of solid 2 rc outside browsers**: solid-js exports map node/worker/deno
  conditions → dist/server.js — SSR STUBS WITHOUT REACTIVITY (initial render only).
  Bun AND Node resolve node by default → effects never re-run, silently. Fix:
  `--conditions=browser` (bun flag / NODE_OPTIONS). Upstream: solidjs/solid#2569.
  Encode it in every test/demo script; document loudly for OSS users.
- @solidjs/universal DEV build's createRenderer replaces render() with a variant
  that schedules via {schedule:true} and returns a bare disposer — NO cleanupNodes
  on dispose; prod build has cleanup. Host must own dispose semantics (we do).
- Solid 2 defers effects through its own queue; universal render drains with tail
  flush(). A host-side flush() must call solid's flush() FIRST, then batch.
- solid-js 2: reactivity moved to @solidjs/signals (bun's .bun store); main entry
  re-exports. createRoot owned-by-parent default; effects need owner.
- JSX for solid needs babel-preset-solid/vite 'generate: universal' — bun run
  applies react-style automatic JSX which is SEMANTICALLY WRONG for solid
  (eager children evaluation). v0.1 ships makeH() hyperscript; JSX pipeline is a
  documented gap (needs vite plugin or custom bun plugin later).
- Shadow-tree invariant learned the hard way (review critical): universal's
  reconcileArrays MOVES call insertNode for nodes ALREADY in the parent —
  retain-before-splice is mandatory or duplicates compound. Mirror helper
  attach semantics on BOTH sides.
- Send-failure policy: splice-then-await loses the batch on rejection; once
  shadow/wire may have diverged, POISON (reject future flushes) instead of
  requeue — re-sending a partially-applied batch double-applies.
- rc.1 correction: @solidjs/universal dev.js and universal.js are byte-
  identical; NEITHER exported render() runs cleanupNodes. Own your dispose.

## Slice 4 learnings (2026-08-24)

- My "cycles structurally impossible" claim was falsified by review: a PARENTLESS
  ANCESTOR (the root!) could be appended into its own descendant — parentless ≠
  acyclic. Real invariant needs an ancestor walk. Depth cap (256) doubles as the
  render-stack bound and a cycle backstop.
- gpui rgb(hex) skips the TOP byte (`[_, r, g, b]`) — 8-digit #rrggbbaa misrenders
  and forces a=1; rgba(hex) is the correct constructor for alpha colors.
- gpui has NO overflow_scroll style anymore — scrolling is a dedicated element
  (`scrollable()`); v1 maps overflow:scroll → overflow_y_hidden (clip).
- gpui current API notes: entry gpui_platform::application(); `cx.new` comes from
  prelude::AppContext; WindowHandle::update closure is (view, window, cx) — 3 args;
  cx.spawn(async move |cx|…); channels pattern stdin-thread ↔ futures mpsc → main.
- Validation/rendering agreement principle: if the renderer silently drops it
  (children of text nodes), validation must reject it — else `applied` lies.

## Slice 2 learnings (2026-08-24)

- gpui on zed main (Aug 2026): entry is `gpui_platform::application().run(|cx: &mut App|…)`
  (NOT crates.io 0.2.2's `Application::new()`). Deps: `gpui` + `gpui_platform` git;
  macOS feature `font-kit` (real glyphs; without it placeholder text system), Linux later
  `wayland`+`x11`. Window: `cx.open_window(WindowOptions{window_bounds:Some(WindowBounds::
  Windowed(bounds)),..Default::default()}, |_,cx| cx.new(|_| View))`. Quit: `cx.quit()` on App.
  Async: `cx.spawn(async move |cx| …)` with `cx.background_executor().timer(...)`.
- Cargo git deps auto-discover `gpui`/`gpui_platform` by name across the zed workspace;
  Cargo.lock pins the resolved commit — reproducible until we deliberately bump.
- **RESOLVED (2026-08-24)**: user installed full Xcode + Metal toolchain
  (`xcrun metal` → Apple metal 32023.864); helper builds/tests green.
  First build of zed git deps ≈ minutes, cached thereafter.
- Parity contract pattern: Rust `#[ignore]`d generator test writes the snapshot fixture;
  Rust locks its own emission byte-exact; bun decodes the same snapshot. Rust→TS drift
  now caught by committed tests on both sides.

## S10 text-input gotchas (caught live during implementation)
- gpui `window.handle_input(focus_handle, impl InputHandler, cx)` is PAINT-
  PHASE ONLY (debug_assert_paint) — cannot register from render(). Pattern:
  a tiny custom Element (ImeAnchor) inside the input's div whose paint() calls
  handle_input. The handler is rebuilt EVERY frame (input_handlers cleared per
  frame); hold the real state in Rc<RefCell<InputState>> captured by the clone.
  InputHandler is 'static but NOT Send-required (Rc state is fine — proven by
  gpui's own key_dispatch test element).
- The platform text client speaks UTF-16 code units (NSTextInputClient): every
  InputHandler method takes/returns UTF-16 ranges; astral chars (emoji) = 2
  units. Convert with encode_utf16()/String::from_utf16 — never byte offsets.
- `App::update(Entity)` is PRIVATE in this gpui. To repaint a view from a raw
  `&mut App` (the InputHandler's cx), use `App::notify(entity_id)` + `Entity/WeakEntity::entity_id()`.
- Controlled sync is loop-free because Solid only re-emits setValue when the
  value prop differs (prev !== value in setProperty). setValue overwrites
  internal edits + resets caret to end — the React controlled-input contract.
- Event line ordering from a command: the change event writes INSIDE
  window.update (main thread), the result reply after it (stdin thread) — the
  change event line deterministically precedes the result line. Window tests
  rely on this.
- Backspace/delete/cut arrive as replace_text_in_range (or default paste) via
  the IME client — no per-key handling needed for basic editing.
