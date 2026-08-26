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

## Runtime facts (verified 2026-08-26)

- Solid: `latest` 1.9.15, `next` = 2.0.0-rc.3 (2026-08-26). The project pins
  `solid-js`, `@solidjs/universal`, `@solidjs/web`, and
  `@solidjs/babel-plugin` to the same rc.3 release. The custom renderer uses
  `@solidjs/universal`'s `createRenderer` surface.
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
- JSX (pre-rc3 history): Bun's automatic JSX applies React-style transforms that
  are semantically wrong for Solid (eager children evaluation). Current rc3 uses
  `@solidjs/babel-plugin` with `generate: "universal"`, `moduleName:
  "@solid-gpui/solid/jsx"`, and the checked-in Bun preload; `makeH()` remains
  available for runtime-authored paths.
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

## Solid 2 rc.1 effect landmines (S12, 2026-08-25)
- `@solidjs/signals` rc.1's effect runner stores a non-function RETURN VALUE
  (the effectFn's, for the two-arg createRenderEffect form) in the effect's
  cleanup slot and calls it on the next run. Returning a plain object (e.g. a
  style bag) → `E is not a function` → global `[REACTIVITY_HALTED]` on the
  first re-run. Pattern: compute returns VOID and stashes the value in a
  closure; the commit reads it from there and also returns nothing.
- Importing `solid-js` from a NEW module (h.ts) resolved a mismatched
  signals build vs what `@solidjs/universal` runs under — effects crashed
  reading owner fields (`t.ft is not a function`). Always use the
  Renderer's own `R.effect` primitive, never import solid-js primitives
  beside universal.
- The dev build (`--conditions=browser,development`) silently never re-runs
  effects created inside the tree code() in some cases where prod does —
  when debugging reactivity, ALWAYS reproduce with plain
  `--conditions=browser` (the condition the suites actually run under).
- h() props are read eagerly; only `style` accepts a function (reactive bag,
  compiled-JSX getter semantics). Signal-driven style updates flow ONLY
  through that path today.

## S12 lessons (2026-08-25)
- gpui's ListState first prepaint wipes uniform height hints; a steady list
  never re-renders, so heights stay unknown forever after single-frame
  mounts. render must request ONE settle frame after any splice
  (self-terminating). This was the S11 "atEnd null after toggle" mystery's
  sibling — same wipe, different trigger.
- A panic while holding a suite Mutex poisons it; every later test then
  fails instantly with PoisonError. For ordering-only locks use
  `lock().unwrap_or_else(|p| p.into_inner())`.
- Emission tests that only RECORD mutations never prove the wire accepts
  them: the Solid renderer's setStyle/setAnimation pair poisoned the real
  helper (helper-side setStyle REPLACES the map, deleting numeric starts
  before the same-batch setAnimation applied). Cross-layer window tests
  must replay renderer-shaped batches through the real helper.
- Per-id animation state with entry replace drops in-flight keys; timing
  belongs per-TRANSITION (key), merged by upsert.

## S13 markdown port learnings (2026-08-25)

- Comet (zeronsh/comet, MIT) markdown subsystem map: parser.rs is fully
  standalone (pulldown-cmark 0.12 → BlockTree IR + GFM bare-URL autolink
  + merge_runs canonicalization); render.rs depends on theme crate +
  streaming veil + selection + copy plumbing — port flatten/render blocks,
  stub the theme, drop the rest. changes.rs (diff) is 5248 LOC separate;
  syntax = tree-sitter × ~25 grammars (heavy; separate slice).
- Harness: writing anything under /tmp is BLOCKED by the safety filter on
  macOS (/tmp → /private); use in-repo paths or ~/dev/scratch. The task
  tool can start failing mid-session with "expected a start/resume
  request" for ALL new launches (scout launched fine, reviewer rejected ×5
  with identical request shape) — when it hits, record the review as
  BLOCKED and retry next session rather than claiming it ran.
- gpui in our pinned zed (35aab21): rgba(u32) is the only rgba signature
  (no 4×float overload — Comet's rgba(r,g,b,a) calls must become
  rgba(0xrrggbbaa) or hsla); TextRun/background_color is the square inline
  wash (rounded canvas underlay is Comet-only, tied to their selection
  machinery); InteractiveText::on_click(ranges, |ix, window, cx|) matches.
- rustc (1.98) inference regression: `out.last_mut()` match on `==` of a
  generic field + Vec::with_capacity no longer infers — annotate the Vec
  type when porting Comet code (merge_runs needed `Vec<InlineRun>`).
- Fixture canonicalization: Rust StyleMap is a BTreeMap → style keys sort
  alphabetically in to_json; hand-written fixtures with unsorted style
  objects fail the byte-equality round trip. Normalize via
  python json.dumps(sorted style keys, separators=(',',':')).
- makeH: function-valued props other than style (markdown `source`) need
  the SAME R.effect wrap or updates never re-flow (eager read at mount).
- insertNode refusal pattern: when the wire rejects an attach
  (markdown children), refuse client-side with console.warn instead of
  emitting an op that would poison the session.
- SIGINT teardown of examples hangs (dispose race) in the agent sandbox
  even for the pre-existing counter demo — not an S13 regression; kill -9
  the bun pid after the probe.
- Window-test mutation-check discipline that works: perl-inject a
  panic!() into the render path under test, observe the GUI test FAIL
  (helper abort kills the ack), revert, observe pass.

## S13 review learnings (2026-08-25)

- Reviewer r1 caught two real Majors the suites could not: (1) upstream
  Comet's ARITHMETIC ix schemes (ix*100+ci, ix*100+item_ix*10+ci) collide
  for ordinary documents, and gpui (35aab21) has NO duplicate-id assert —
  duplicate GlobalElementIds silently SHARE element state (lockstep
  scrollers, shared hover). Ported id schemes must be INJECTIVE by
  construction: a pre-order counter is the safe pattern, deterministic ⇒
  stable across re-renders. My port also regressed table_cell_ix(ix→top_ix)
  — when porting, diff EVERY id/key derivation against upstream.
- universal rc.1 sentinel flows: multi-child inserts create text-node
  sentinels; reconcileArrays then calls removeNode UNCONDITIONALLY for
  leftovers. Any client-side "refuse this op" policy must also refuse the
  symmetric removal or the helper rejects it (applyFailed → poison).
  Pattern that holds: refused insert records shadow bookkeeping + a
  refused-id set; removal is shadow-only; teardown destroys refused ids
  explicitly (the root's wire cascade cannot see them).
- KNOWN GAP (future slice, affects ALL element types, pre-existing):
  nodes removed from the tree mid-session are never destroyed helper-side
  until session end — universal's exported render() overrides the base
  renderer that would call cleanupNodes, so cleanupNodes is unreachable.
  Candidate: session-level GC of detached element ids. (Review r2 Note 2.)
- Task tool contract: reviewer prompts REQUIRE literal "Parent context:",
  "Proposed changes:", "Write/read policy:", "Acceptance criteria and stop
  condition:" sections — missing labels are rejected as "expected a
  start/resume request" even when operation=start; long prompts (>~6KB)
  also fail — put the full brief in a file (.pi/review-tmp/) and reference
  it from a short prompt.

## S13e syntax highlighting learnings (2026-08-25)

- tree-sitter grammar crates rename constants between releases
  (tree_sitter_python::HIGHLIGHTS_QUERY vs HIGHLIGHT_QUERY) — pin grammar
  versions EXACTLY like upstream Comet's "=0.26.11" style or the port
  breaks at compile time.
- gpui StyledText::with_runs panics on over-length runs in DEBUG AND
  RELEASE (the cfg only changes the message; trailing assert is
  unconditional). Any pipeline feeding spans→runs must clamp to the text
  length defensively — a resolver bug must degrade to wrong colors, never
  panic.
- The r1 Blocker was MY simplification: comment said "content-keyed" but
  the code matched language-only (first-match wins). Two same-language
  fences with different code then shared one document. Lesson: when a
  comment names an invariant ("content-keyed"), make the TYPE carry it —
  the resolver signature taking only &str let the bug compile. The fixed
  signature takes (lang, code).
- Edit-script hygiene bit again: a python replace with an unconditional
  success print silently no-op'd on an unmatched anchor and I marked the
  TODO done. Always assert the anchor matched AND verify on disk before
  ticking a checkbox.
- Reviewer-launch contract that works: literal "Goal:", "Parent context:",
  "Proposed changes:", "Write/read policy:", "Acceptance criteria and stop
  condition:" sections in the prompt; full brief in .pi/review-tmp/*.md,
  short prompt references it.

## S13f diff-fence learnings (2026-08-25)

- Unified-diff line classification, stateless version: space-gate the file
  headers ("+++ "/"--- " — git always writes the path after a space) so
  ADDED CONTENT beginning with ++ (e.g. `+++i;`) classifies Add. Upstream
  Comet does strip_prefix("+++ ") — same rule. Header-shaped content
  ("+++ path") is genuinely ambiguous without hunk-state tracking: pick
  the header reading, document it, pin it with tests. Plumbing lines
  (new/deleted file mode, rename/copy from/to, Binary files, similarity
  index) belong in Meta/muted.
- LAYOUT: negative mx + compensating px for "full-bleed" rows inflates
  gpui's children-bounds scroll extent by 2×padding (dead band at max
  scroll). Taffy's DEFAULT cross-axis stretch already spans flex-col
  children to the container content width — `.bg(wash)` alone gives an
  honest edge-to-edge wash (verified with a scratch taffy model:
  scroll_max 24 → 0).
- Review-request pattern that caught real issues: ask reviewers to
  EMPIRICALLY reproduce layout claims (scratch cargo project modeling the
  element chain) instead of trusting source reading — r2 reproduced the
  24px inflation before verifying the fix.
- GFM fence info strings are case-insensitive; match language tags with
  eq_ignore_ascii_case.

## S15 — JSX pipeline (2026-08-25)

- **Compiled JSX passes RAW expression values to text nodes.** `{count()}` with a
  number signal reaches createTextNode/replaceText as `0` (number). `setText`
  is a string op on the wire — Rust serde rejects `"text":0` and the batch
  never decodes. Coerce at the boundary (`textOf`: null/undefined → "",
  else String(v)) in renderer.ts AND jsx.ts; universal's Renderer types lie
  (say `string`), runtime disagrees.
- **A batch the helper cannot decode answers with `seq: null`** — it never
  parsed, so there is no seq to echo. The client used to route that to
  `onUnmatchedReply` (usually unset) and the pending flush hung FOREVER,
  silently. Now: reject the OLDEST pending (strict line ordering makes it the
  culprit). Debugging signature: helper alive, one `[wire>>>]` line, no ack,
  no stdin close.
- **Universal rc.1's echoed `effect` supports the two-arg object-returning
  form correctly** (createRenderEffect(fn, effectFn)) — the S12
  [REACTIVITY_HALTED] cleanup-slot landmine applies to importing solid-js
  primitives BESIDE universal, not to universal's own wrapper. Empirically
  verified with a probe before trusting it. Do not re-add emulation.
- **Universal rc.1 does NOT echo `setProperty`** — it is consumed internally by
  the echoed `setProp` dispatcher. Bind createElement/setProp to
  `raw().setProp`, which forwards to our config setProperty.
- **Bun preload plugins DO transform the entry file** (onLoad applies to the
  main entry too). Plugin gotchas: `targets: { esnext: true }` is invalid in
  @babel/core transformSync (use no targets); module specifier resolution
  needs the package exports map (`"./jsx"`) AND a root workspace devDep link
  for examples/ to resolve `@solid-gpui/solid/jsx`.
- **bun run script chain**: `bun --conditions=browser --preload X.ts FILE`
  works, but inserting the subcommand `run` after flags prints usage —
  scripts encode the direct form.
- Tests that assert wire mutations MUST `await suite.flush()` — ops queue
  until then; and register effects AFTER creating the elements they reference
  (TDZ applies to commit closures too).

## S16 - npm packaging (2026-08-25)

- **npm pack does NOT apply publishConfig** - the tarball manifest keeps the
  dev exports (./src/index.ts). Staging-rewrite in scripts/pack-package.mjs
  (copy files, rewrite exports to dist, pin workspace:* to version) is the
  explicit, testable alternative.
- **Node 24 parseArgs**: positionals are parsed.positionals, NOT values._
  (values._ is undefined). Bites every .mjs script written from memory.
- **tsdown CLI has no build subcommand** - bunx tsdown directly (a positional
  is treated as the ENTRY -> confusing UNRESOLVED_ENTRY errors). Per-package
  tsdown.config.ts in each package dir resolves relative to that package
  (root-level config resolved entry paths from ITS location - outDir landed
  under scripts/ the first time).
- **BSD/macOS cp -R nests the source dir into an EXISTING destination under
  BOTH spellings** - "cp -R dir dst" and "cp -R dir/. dst" (verified live;
  the trailing-dot contents rule does not hold under -R on BSD cp). This
  shipped a duplicate dist/dist tree in every published tarball twice. Use
  Node fs.cpSync(src, dst, {recursive:true}) with a freshly rmSync'd
  destination instead of shell cp in pack scripts.
- **E2E local-tarball installs**: bun add fails on inter-package version pins
  (no registry has them). Use npm + overrides mapping every @solid-gpui/*
  dep to a file: tarball - simulates the published registry state.
- **ESM-only packages can require.resolve through exports maps only via**
  import.meta.resolve + fileURLToPath in Node scripts.
- **Safety filter**: blocks destructive shell cleanup touching node_modules
  and /tmp paths. Use fresh versioned scratch dirs under ~/dev/scratch.
- Release invariant kept structural: platform helper packages publish FIRST
  (client optionalDeps pin exact versions; a client published before its
  helpers installs broken for everyone at that version).
- Helper binary in tarball stays UNCOMPRESSED: npm preserves the exec bit;
  gzip saved <40 percent and would cost a runtime decompress step.

## P1 — styling depth (2026-08-25)

- **Non-interactive divs skip .id()+apply_interactive in build_element** —
  any feature needing gpui Stateful (hover/active refinements!) must extend
  the routing predicate (element_needs_stateful), else mutations are acked
  but never rendered: the applied-count-lies trap (invariant 1). Reviewer
  caught it because the GUI smoke asserted only the ack, not the render.
- **Removing a key from one side's key list while the OTHER side transforms
  it first is a silent-dead-feature recipe**: shorthand expansion moved
  padding→physical keys pre-wire; ANIMATABLE_STYLE_KEYS still listed
  "padding" (never emitted) — transitionMs+padding flowed statically with
  zero warnings. When JS transforms keys, update downstream closed lists on
  BOTH sides in the same commit, and grep test suites for the old key.
- **CSS TRBL fan-out semantics**: 1→all, 2→(v,h), 3→(t,h,b), 4→t,r,b,l;
  X shorthand takes sides[3]/sides[1], Y takes sides[0]/sides[2]. Easy to
  get the X indexing backwards — the fanout-table pattern (FANOUTS keyed by
  shorthand, fed a 4-tuple) makes each mapping one reviewable line.
- **gpui hover()/active() take StyleRefinement, which implements Styled** —
  one generic apply_style<S: Styled> table drives base Div styles AND state
  refinements; overflow stays out of the generic (element-specific scroll
  handles). active() requires Stateful<Div> — apply inside apply_interactive.
- Rust protocol tests building nodes: Node::new is crate-private — build via
  RetainedTree + Mutation::apply (public API) instead.

## P2 — input maturity (2026-08-26)

- **Recon trước khi xây**: input core đã trưởng thành hơn roadmap giả định
  (IME composing, UTF-16, autosize, emoji tests). Slice thu gọn thành
  gap-closing có bằng chứng. Đọc code TRƯỚC khi kế hoạch nói "xây mới".
- **onInput/onChange split là SEMANTIC BREAK cho consumer cũ**: mọi binding
  onChange-co-từng-keystroke chết im lặng (chỉ nhận commit-on-blur). Sau
  split, grep examples/README cho onChange — demo counter.ts bị reviewer
  bắt (đã sửa cf42bdc).
- **Dirty-flag lifecycle phải liệt kê được từng mutation site**: edit_input,
  replace_and_mark (IME), paste/simulateInput/Enter → đều phải đi qua
  edit paths; setValue là clearing path duy nhất. Reviewer verify bằng cách
  đếm sites (3) — giữ con số đó khi thêm edit path mới.
- **Anchor xóa ở ĐÚNG các chỗ value thay đổi** (edit + setValue), giữ qua
  movement. Bỏ sót một chỗ → stale selection thay đổi nghĩa của edit kế
  tiếp (M2/M3 đều là biến thể của lỗi này).
- **Sink unification có giới hạn**: emit_event qua self.sink nhưng
  emit_key/emit_key_up vẫn ghi stdout trực tiếp — đừng nói "tests observe
  EVERY event" trong comment nếu chưa đúng.
- Platform NSRange là sorted (location+length) — selection_reversed
  unreachable qua set_selection production; nếu platform nào giao
  anchor-first, dạy set_selection direction.

## P3 — key bindings (2026-08-26)

- **HAI gate phải sync**: build_element (element_needs_stateful) và
  apply_interactive (wants_focus) là hai phép tính riêng — thêm điều kiện
  focus mới vào MỘT cái tạo element stateful-nhưng-không-focusable, listener
  key ngồi trên element không bao giờ nhận key (gpui chỉ deliver cho focused).
  Reviewer bắt vì GUI smoke ack-only che mất: ack prove apply, không prove
  fire. Bài học: smoke cho feature focus phải assert EVENT, không chỉ ack.
- **Guard stale-index phải che CẢ HAI chiều**: index ngoài list VÀ progress
  counter vượt độ dài sequence mới (bindings swap giữa chord). match
  bindings.get(bi) rồi seq.0[matched] vẫn panic nếu list ngắn đi. Pattern:
  mọi cặp (index, counter) lưu trong state cross-event đều cần guard tổng.
- **Prefix-sharing bindings là bẫy ngầm**: "ctrl-x" đơn + "ctrl-x ctrl-s" —
  thứ tự khai báo quyết định cái nào chết, không lỗi không warning. Chốt
  semantics (first-entry-wins), pin bằng unit, WARN renderer lúc cài đặt.
- **Reviewer session có thể chết giữa chừng** (hết stream sau thinking
  block) — nhận diện bằng "last message là intermediate step"; retry với
  yêu cầu "verdict PHẢI là message cuối" + cho phép đọc transcript cũ làm
  lead. Resume task_id không map session file được thì launch mới.
- gpui keymap (bind_keys + Box<dyn Action>) là action-dispatch tĩnh — không
  hợp closure động JS. Matcher chuỗi thuần + focus-scoped listener là thiết
  kế thay thế đúng hướng (r1 xác nhận hướng, bắt lỗi implementation).

## P4 — desktop commands (2026-08-26)

- **encodeCommand là mặt SỐNG CÒN của command channel mà test cũ không
  chạm**: decodeCommand được test, encodeCommand thì fallthrough silently
  thành {type:getStats} — 7 lệnh mới toàn bộ chết trên client thật. Bài học
  quy tắc: THÊM command type = cập nhật decode + encode + closed-name list
  (3 chỗ) CÙNG commit; test encode kiểu "assert NOT fallthrough" cho từng
  type. Test dùng JSON.stringify thay encodeCommand là test sai seam.
- **Serde enum-level rename_all KHÔNG rename variant fields** (AGENTS.md
  đã cảnh báo từ trước mà vẫn dính): DialogSaveFile.suggested_name decode
  camelCase input thành None im lặng vì Option hấp thụ unknown key. Mọi
  variant có field đa từ CẦN #[serde(rename_all)] variant-level. Lộ thêm:
  Option field re-encode thành "field":null — canonical wire (TS omit)
  cần skip_serializing_if trên TẤT CẢ optional fields.
- **AsyncApp::update trả R trực tiếp, KHÔNG Result** (khác Window::update)
  — dispatch arms phải match theo đúng loại context.
- **Dialog macOS là async callback** (ConcreteBlock + oneshot,
  gpui_macos/platform.rs:777) — await không block main thread; job loop tuần
  tự khiến prompt re-entrancy panic của gpui unreachable từ command channel.
  Nhưng dialog 0 nút = NSAlert không đóng được → session treo vĩnh viễn:
  validate số nút ở API boundary TRƯỚC khi mở dialog.
- GUI smoke ack-only lại che lỗi (như P3 B1): command cần smoke assert
  RESULT payload, không chỉ ack/apply. Round-trip test phải đi qua CẢ
  encoder thật (encodeCommand) lẫn decoder thật (command_from_json).

## P5 — list (2026-08-26)

- **ĐẾM SỐ site khởi tạo trước khi nói "cả hai chỗ"**: ListState có BA nơi
  tạo (eager apply-time ensure_list_state chạy TRƯỚC, + 2 render-time).
  Tôi cập nhật 2, quên site eager — feature chết đúng trên path chính
  (followTail+overdraw) mà smoke vẫn pass (config của smoke diverge alignment
  → render-recreate cứu lấy). Reviewer bắt. Quy tắc: grep TẤT CẢ
  `ListState::new`/constructor calls của type trước khi claim "cả hai sites";
  extract config-helpers dùng chung thay vì copy giá trị mặc định.
- **Eager-path + render-path đôi khi cùng tồn tại cho một feature** (state
  tồn tại trước render) — render-time get-or-create KHÔNG tự sửa được giá trị
  eager tạo sai; phải đồng bộ từ nguồn duy nhất.
- **Recon-first thu gọn scope**: roadmap P5 viết theo kiến trúc JS-windowed
  của prior-art (onRange round-trips, insertedAt); retained-tree của ta đã
  phủ phần lớn — items helper-side, splice prefix/suffix = height-cache
  continuity, itemHeight = hint semantics. Slice co lại từ 6 mục còn 3 gap
  thật. Luôn recon kiến trúc MÌNH trước khi implement theo roadmap mượn.
- Style keys (open set) không cần protocol change — chỉ union TS; command
  mới mới cần lockstep 3 chỗ (decode+encode+name list).
- Pixels không expose field .0 — so sánh bằng px(x) trực tiếp (PartialEq).
- GUI smoke phải assert RESULT payload + error path có tương quan seq —
  smoke P5 lần này làm đúng ngay từ đầu nhờ bài học P4.

## P6 — scrollbar (2026-08-26)

- **window.on_mouse_event là PAINT-PHASE-ONLY và listener sống đúng MỘT
  frame** (Frame::clear drop sau draw-swap). Đăng ký "một lần" ở open_window
  callback / render() đều sai — đúng pattern là element zero-size có paint()
  đăng ký MỖI frame (gpui elements chính làm vậy; ImeAnchor là tiền lệ
  trong repo). Tôi sai 2 lần liên tiếp trước khi ra đúng chỗ — khi API cần
  phase, tìm element có sẵn làm cùng việc trong pinned source.
- **Đừng tin comment cũ về API thiếu**: comment nói ScrollHandle không có
  viewport — thực tế ScrollHandle::bounds() tồn tại (div.rs:4111, populate
  mỗi layout). Reviewer grep vendored source bắt được. Khi ghi "API không
  có", kiểm tra lại bằng grep trước khi viết.
- **Zed ui crate components phụ thuộc theme crate** — vendor nguyên component
  kéo theo chuỗi phụ thuộc; tự viết tối giản theo pattern (ScrollableHandle
  trait) là hợp quy mô hơn cho helper.
- **GUI smoke content scrollable**: phải là div height cố định CHỨA div cao
  hơn — text node mang style height không materialize max_offset. Và sleep
  một frame sau ack trước khi scrollTo/assert offset (layout cần chạy).
- Element trait của pinned gpui: paint() có 8 tham số (kể cả PrepaintState)
  — copy signature từ ImeAnchor thay vì viết từ trí nhớ.
- Smoke mode --smoke <ms> là công cụ nhanh nhất phát hiện debug_assert /
  panic-at-startup: cargo test smoke suite sẽ ĐỎ, đừng để CI skip (GUI skip
  flag) che mất.

## P7 — drag & drop (2026-08-26)

- **Trap AGENTS.md lại ám**: rgb(0x313244e6) 8-digit — rgb drop top byte VÀ
  ép alpha=1.0. Mọi literal màu 8-digit phải rgba() dù chỉ là cosmetic chip.
  Rà bằng rg 'rgb\(0x[0-9a-fA-F]{8}' khi review màu.
- **Rust string escaping trong GUI smoke**: payload JSON lồng vào format!
  cần \\" — 'replace("\"", "\\\\\\\\")' cho HAI backslash (sai); dùng raw
  string r#"\\""# cho một backslash + quote. Escape-test bằng cách in payload
  ra stdout test một lần trước khi tin.
- **gpui drop matching là TypeId**: mọi drag source/target phải chia MỘT
  wrapper type (DragPayload(String)) — payload content thuộc về JS, helper
  opaque. on_drag constructor chạy lúc gesture bắt đầu = miễn phí dragStart
  emitter; on_drop chạy ở MouseUp phase (event-dispatch như on_click, KHÔNG
  phải paint — sink an toàn).
- **encodeBatch TS là JSON.stringify generic** — mutation mới KHÔNG cần
  encode case riêng (chỉ command channel có encode thủ công); chỉ cần decode
  validation. Sinh đôi P4 chỉ áp cho command.
- **on_drag là StatefulInteractiveElement** — drag wiring cần gate-sync như
  class bug P3 (đã có test từ M4 giờ).
- Reviewer chết giữa chừng 2 lần trong phiên (P3, P7): pattern retry với
  "verdict PHẢI là message cuối + budget exploration" hoạt động ổn.

## P8 — canvas draw list (2026-08-26)

- **KHÔNG filter gates bằng rg trong chuỗi &&**: `cargo test ... | rg
  "test result: ok"` nuốt compile failure (rg không match → im lặng), và
  commit đã land với helper KHÔNG BIÊN DỊCH. Independent reviewer bắt được.
  Luôn verify bằng exit code: `cmd > log 2>&1; echo exit=$?` rồi đọc log.
  (Safety filter còn chặn /tmp cho log — dùng .pi/review-tmp/.)
- **slice::as_chunks::<N>() trả TUPLE** (&[[T; N]], &[T]) — destructuring
  trước khi .iter(). Clippy gợi ý as_chunks thay chunks_exact(2) nhưng API
  là tuple, không fluent chain được.
- **Fixture mới phải có parity test TS NGAY TRONG slice** (không chỉ Rust
  round-trip) — hợp đồng cross-language là CẢ HAI suite parse mọi fixture;
  r1 đã bắt thiếu batch-canvas-01.json phía TS. Checklist: fixture + Rust
  round_trip test + TS toEqual/shape test, cùng một commit.
- **TAG_ELEMENT_TYPES từng thiếu scrollbar** (P6 gap): element JSX lạ rơi
  vào `?? "div"` SILENT — thêm ElementType mới phải thêm tag map cùng lúc.
- gpui: shape_line nằm trên WindowTextSystem (window.text_system()), KHÔNG
  phải App::text_system() (Arc đó không có paint caches); PaintQuad là
  struct công khai (không có free fn quad()); TextRun không có field
  metadata trong bản pinned này.

## P9 — menu bar macOS (2026-08-26)

- **KeyBinding::new PANIC trên wire input**: upstream .unwrap() — keystroke
  sai kiểu "cmnd-o" giết cả helper. Wire input KHÔNG BAO GIỜ đi thẳng vào
  API panic-able; pre-flight validate từng token (split_whitespace +
  Keystroke::parse) — byte-identical với KeyBinding::load để validation và
  construction không thể lệch. Fail lệnh có type (ApplyFailed), không skip
  im lặng.
- **clear_key_bindings trước rebind** = menu bar sở hữu shortcut của nó;
  bind_keys tích tụ vĩnh viễn nếu chỉ add. May là helper không dùng keymap
  cho gì khác (P3 keys là element listeners).
- **osAction items bỏ qua keystroke**: macOS tự cấp equivalent; binding thêm
  sẽ dispatch JS event — mâu thuẫn hợp đồng "native selectors không tới JS".
- AsyncApp::update bản pinned trả R trực tiếp (infallible, panic nội bộ khi
  app gone) — không phải mọi context update đều Result như WeakEntity::update.
- gpui: MenuAction derive Action #[action(no_json)] — không cần schemars/
  serde; một on_action global handler cho MỌI instance (payload trong struct);
  Unbind(name) tồn tại nhưng clear+rebind đơn giản hơn.

## P10 — svg/img media + overlays (2026-08-26)

- **Hsla::default() = alpha 0** (derive(Default) trên 4 f32) — "màu mặc
  định" nào cũng phải set a=1.0 tường minh. gpui tự fallback text không
  nhãn sang One Dark light hsla(221,11%,86%,1); helper không set theme nên
  hardcode màu đó + cite fallback_themes.rs là cách nhất quán. Svg KHÔNG có
  text.color thì KHÔNG paint gì (Option gate).
- **Element type mới = refusal surface mới**: HELPER_OWNED_TAGS (renderer)
  phải mở rộng CÙNG LÚC với reject lists Rust (retained.rs) — insertNode,
  events, state layers, dragData, keys, transitionMs. Canvas từng thiếu
  prop guards từ P8 mà không ai thấy đến P10 r1 — checklist: thêm element
  helper-owned → cập nhật cả HAI phía trong một commit.
- **svg().data(bytes)** render không cần AssetSource (hash-cache nội bộ);
  img file path đi Resource::Path → fs::read thẳng; Uri qua http client.
  img path sai fail ASYNC (broken-image, no panic/event) — không validate
  lúc setSrc (TOCTOU).
- **Overlay wrapper pattern**: build_element = inner + apply_overlays;
  anchored BÊN TRONG deferred (deferred(anchored(x)) = popover). Mọi nhánh
  early-return phải chảy qua wrapper.
- URL.pathname KHÔNG percent-decode — luôn fileURLToPath(new.URL(...)).
- Demo <text>string</text> đã dính lỗi attach 3 LẦN (P7/P8/P10): text
  element nhận nội dung qua PROP, string child trong JSX chỉ hợp trên div.

## Solid 2 rc.3 compatibility (2026-08-26)

- Pin `solid-js`, `@solidjs/universal`, `@solidjs/web`, and
  `@solidjs/babel-plugin` to the same rc.3 release; rc.3 universal declares a
  `solid-js ^2.0.0-rc.3` peer.
- The rc.3 JSX compiler is a Babel plugin, not the old preset: use
  `plugins: [[solidPlugin, { generate: "universal", moduleName: ... }]]`.
- Unlike rc.1's observed disposer, rc.3 universal calls `cleanupNodes` during
  render disposal. The hook must tear down the whole shadow subtree so
  helper-owned refused children are destroyed, while `renderWithDispose`
  retains a shadow-guarded fallback for older builds.
- [warning] If the macOS window server is unavailable/occluded, GPUI frame
  stats can remain at one frame even while stdio mutations are acknowledged;
  use `SOLID_GPUI_SKIP_GUI_TESTS=1` for headless verification and report the
  frame test separately rather than attributing it to the JS migration.
- [discovery] P12 benchmark on Bun 1.4.0 across 11 fixtures: numeric positional
  rows reduced UTF-8 bytes 49.60% (4504→2270), but the generic row-building
  encoder measured 27.59–30.04% slower. Keep the object wire format; do not
  reopen P12 without a direct encoder and explicit version/compatibility design.
