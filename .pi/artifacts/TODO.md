# TODO

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

### 2026-08-26 - P7: drag & drop + tooltips
status: CLOSED 2026-08-26 (r1 NOT CLEAN 1M/3m → fixes 0b3aa5f; tooltip deferred to its own slice)

Goal: per roadmap P7 — dragData prop (any JSON) starts a drag with the
element as its own preview; onDragStart/onDrop events; dragOverStyle state
layer; tooltip prop (string or element ref, shown on hover). Recon gpui
machinery first: external_drag_payload/on_drag (we saw on_drag in P6 recon),
DragMoveEvent, hover detection for tooltip timing, anchored() for tooltip
positioning.

- [x] P7-a recon: on_drag<T,W>(value, constructor) — constructor gọi ĐÚNG
      lúc drag bắt đầu (dùng làm dragStart event), preview là Entity<W:
      Render> riêng; on_drop<T> match bằng TypeId → mọi source/target chia
      MỘT type DragPayload(String) chứa JSON; drag_over::<S> (không phải
      drag_over_style) nhận StyleRefinement + payload + window + cx; hitbox
      is_hovered có sẵn cho tooltip. V1 scope chốt: dragData (JSON), dragStart/
      drop events, dragOverStyle layer, preview chip tự chế (label 24 chars);
      TOOLTIP (string) DEFERRED — slice riêng, cần hover-timing state + overlay.
- [x] P7-b: EventType DragStart/Drop + StyleState::DragOver + Mutation
      SetDragData (JSON string, empty=clear; markdown reject) — lockstep đủ
      mọi list (KNOWN events/styles/ops) + fixture batch-drag-01.json both
      sides byte-identical
- [x] P7-c: DragPayload(String) shared TypeId + DragPreview (Render,
      chip translucent label 24 chars); on_drag constructor = dragStart
      emit (value=payload); on_drop emit drop (value=payload);
      drag_over::<DragPayload> cho layer (clone map trước closure — lifetime
      node không thoát); element_needs_stateful mở rộng (drag source + drop
      listener đều cần stateful path)
- [x] P7-d: dragData prop (stringify tự động, undefined→clear, markdown
      warn+drop), onDragStart/onDrop vào EVENT_NAMES, dragOverStyle nhánh
      thứ 3 của state layers; 2 tests renderer (wire shape + clear) + GUI
      smoke (ack 7 ops + clear ack) + fixture parity TS. Demo để P7-review
      quyết có cần thêm.
- [x] VERIFY: gates + independent review — reviewer đầu (mt9p4kl7) chết
      giữa chừng lần nữa; retry (mt9p8e7x) hoàn tất. Verdict NOT CLEAN:
      M1 preview chip dùng rgb() với hex 8-digit — TRAP CÓ SẴN trong
      AGENTS.md (rgb drop top byte + ép alpha 1.0), chip "translucent" thành
      opaque + sai hue trên MỌI drag; M2 escaping smoke sai (2 backslash →
      payload mangled trên wire, test pass vì chỉ assert ack); M3 thiếu
      retained unit setDragData; M4 gate-sync drag/drop chưa có test (class
      bug P3). Invariants A–F PASS hết (D gate-sync confirm đúng code, chỉ
      thiếu test; sink-in-drag-dispatch an toàn — constructor chạy ở
      MouseMove phase như on_click, không phải paint). Fixes 0b3aa5f: rgba(),
      escape đúng \", unit M3+M4, dead-code N1. Gates: bun 151/151 · cargo
      32+83+18. P7 CLOSED (drag&drop); tooltip = slice riêng khi cần.

### 2026-08-26 - P8: canvas (recorded draw list)
status: CLOSED 2026-08-26 (r1 NOT MERGEABLE: helper không biên dịch do
      as_chunks tuple + fixture thiếu TS parity; fixes 7aadf8c; r2 CLEAN)

- [x] P8-a recon: gpui canvas element + paint primitives — DONE trong chat:
      canvas(prepaint,paint) FnOnce nhưng helper rebuild mỗi frame → OK;
      paint_quad(PaintQuad), PathBuilder (move_to/line_to/add_polygon/close,
      stroke(w)/fill()), text_system.shape_line + ShapedLine::paint (origin,
      line_height, TextAlign::Left, align_width None); font ".n" như markdown.
      V1: rect/path/text, coords absolute px, replace-wholesale, NO readback
      (PLAN lesson #4).
- [x] P8-b protocol lockstep: ElementType Canvas ("canvas") cả 2 closed sets;
      Mutation::SetDrawList {id, items}; DrawItem enum tag "type" —
      rect{x,y,w,h,color,cornerRadius?}, path{points[[x,y]..],color,
      strokeWidth?|closed?}, text{x,y,text,size,color}. Node.draw_list field;
      canvas reject children (như text) + interactive props (như markdown);
      setDrawList trên non-canvas = InvalidMutation; fixture batch-canvas-01
      byte-identical.
- [x] P8-c helper: build_canvas_element qua gpui canvas(); rect → paint_quad
      (+corner_radius), path → PathBuilder stroke/fill + add_polygon/segments
      + paint_path, text → shape_line single TextRun + paint. Origin offset
      từ canvas bounds.
- [x] P8-d renderer TS: drawList prop (chỉ canvas; element khác warn+drop);
      decode validation TS (mỗi variant đầy đủ fields, points là number-
      pairs); tests wire shape + reject paths; demo nhỏ.
- [x] VERIFY: r1 (mt9r5qak) bắt 2 findings nghiêm túc — (1) helper KHÔNG
      BIÊN DỊCH: as_chunks::<2>() trả TUPLE, .iter() không tồn tại; chuỗi
      gates rg-filter của tôi nuốt compile failure nên commit đầu land hỏng;
      (2) batch-canvas-01.json thiếu parity test TS. Fixes 7aadf8c:
      destructuring đúng + TS round-trip/reject tests; gates verify lại bằng
      EXIT CODE tường minh (cargo/bun/tsc/fmt/clippy đều exit=0). r2
      (mt9rmigb) CLEAN. Bài học exit-code-gates vào MEMORY.

### 2026-08-26 - P9: menu bar (macOS)
status: CLOSED 2026-08-26 (r1 NOT MERGEABLE 1M/3m; fixes b9f66b5; r2 CLEAN + 2 doc minors fixed)

- [x] P9-a recon: gpui Menu/MenuItem/set_menus (app vs window level), action
      dispatch model (typed actions vs runtime names), keystroke wiring,
      separator/role support; quyết định đường event-back-to-JS.
- [x] P9-b protocol: surface chốt sau recon (nghi hướng command-channel cho
      set + event mới cho click) + lockstep + fixture.
- [x] P9-c helper: dựng menu thật + forward click về JS.
- [x] P9-d renderer TS + tests + demo.
- [x] VERIFY: r2 (mt9udrx1) CLEAN. Major fix xác nhận faithful: per-token
      Keystroke::parse BYTE-IDENTICAL với upstream KeyBinding::load
      (split_whitespace) nên validation và construction không thể lệch nhau;
      validation chạy TRƯỚC clear_key_bindings nên lệnh fail giữ nguyên
      keymap cũ. 2 Minor doc r2 đã sửa (MenuState comment stale, JSDoc
      trùng). Note ghi nhận: dedup keystroke giờ là first-wins silent —
      chấp nhận có chủ ý.

### 2026-08-26 - P10: anchored / deferred / img / svg / image-cache
status: CLOSED 2026-08-26 (r1 NOT MERGEABLE: Major refusal-gap svg/img;
r2 NOT MERGEABLE: tint fallback alpha-0; fixes c3b25a8+225d09a; r3 CLEAN)

- [x] P10-a recon: svg().data(bytes) render trực tiếp KHÔNG cần AssetSource
      (hash-cache nội bộ) + tint qua text_color → tái dùng style key "color"
      sẵn có; img: ImageAssetLoader xử lý Resource::Path bằng fs::read THẲNG
      (không AssetSource), Uri qua http_client → v1 nhận path tuyệt đối +
      http(s); deferred(child) là WRAPPER đơn giản (.with_priority);
      anchored() wrapper với 8 Anchor corners + snap_to_window;
      image_cache SKIP — window image_cache_stack đã cache sẵn.
      Scope chốt: 2 element mới (svg/img) + 2 mutation wrapper
      (SetDeferred/SetAnchored); anchored giữ nguyên trong scope vì chỉ là
      wrapper rẻ.
- [x] P10-b protocol lockstep (element types/mutations moi).
- [x] P10-c helper wiring.
- [x] P10-d renderer TS + tests + demo.
- [x] VERIFY: 3 vòng review. r1: Major — renderer refusal (anti-poison)
      không cover svg/img → misuse tự nhiên poison session; fix
      HELPER_OWNED_TAGS chung cho MỌI guard + canvas được bù guards thiếu
      từ P8. r2: Major — fallback Hsla::default() là ALPHA-0 (derive trên 4
      f32) vẫn invisible; fix = One Dark text OPAQUE hsla(221,.11,.86,1)
      khớp default hiệu lực của gpui (cite fallback_themes.rs). r3 CLEAN.

### 2026-08-27 - Gate 4 runtime contract + sidecar packaging baseline
status: done | updated: 2026-08-27

Goal: close Gate 4's headlessly-verifiable half — a production helper-
resolution guard, packaged-binary permission enforcement, declared runtime
ranges, and the signing/packaging runbook — leaving hosted GUI evidence and
cert-dependent signing as explicit user/hosted actions.

#### Scope decisions (safe assumptions under AFK)

- Production guard is opt-in via `SOLID_GPUI_NO_DEV_FALLBACK=1`, set by the
  app launcher; library users keep the dev-target convenience untouched.
- The explicit helper-path API (SOLID_GPUI_HELPER / spawnHelper binary) is the
  sanctioned "launcher" contract; no bespoke bundle-layout resolver is added
  until a concrete app layout exists (ROADMAP allows launcher OR API).
- Declared runtimes: Bun ≥ 1.4, Node ≥ 20 (LTS 20/22/24 verified for the
  client's node: APIs). engines fields are advisory.
- Signing/notarization steps are documented for the user to run (certs are
  user-held); release workflow keeps packaging + exec smoke as CI evidence.

#### Slices

1. Production resolution guard in binary.ts (RED first): skip dev target,
   production-specific guidance error — verify: focused client tests
2. pack-helper.mjs chmod 0o755 after copy — verify: script dry-run + release
   workflow packaged-binary smoke as evidence
3. engines fields + README runtime-declaration section
4. docs/packaging.md runbook (bundle layout, launcher contract, signing,
   upgrades, cleanup); full gates; independent review; close

#### Verification

- RED observed: the two production-guard tests failed before the binary.ts
  change (dev target still won under the flag; error mentioned cargo).
- `bun run test` 227 pass / 0 fail across 23 files; `bun run typecheck`,
  `bun run check:release` (with the new engines field), and
  `git diff --check` exited 0.
- Pack evidence: `node scripts/pack-helper.mjs --target darwin-arm64
  --binary target/debug/solid-gpui-helper` produced a packaged binary at mode
  0755 (`.pi/review-tmp/g4-pack/`); the release workflow's existing packaged-
  binary smoke remains the CI-side execution proof.
- docs/packaging.md records the launcher contract (`SOLID_GPUI_HELPER` +
  `SOLID_GPUI_NO_DEV_FALLBACK=1` before spawn), bundle layout, codesign/
  notarytool steps with user-held certs, version pinning, and crash-cleanup
  expectations; README declares Bun ≥ 1.4 / Node ≥ 20 and links it.
- Remaining Gate 4 exit items are explicitly external: clean-machine launch
  with user-signed artifacts and hosted Windows/Linux GUI evidence.

#### Review outcome

- Independent review (general agent, full envelope) returned `partial` with a
  single [blocker]: engines lived only in the private root manifest, so the
  published packages did not declare Node ≥ 20. Fixed by adding `engines:
  {node: ">=20"}` to the client, solid, and protocol package manifests;
  re-verified by repacking `@solid-gpui/client` and inspecting the staged
  manifest (engines present), plus `check:release`, the full 227-test suite,
  both consumer typechecks, and `git diff --check` — all green.
- Reviewer-verified evidence carried into the record: guard tests 7/7
  (binary.test.ts:31-90), chmod observed mode 755 on the packaged helper,
  runbook accuracy (signing/clean-machine marked external), release smoke
  path release.yml:89-92.

### 2026-08-27 - Gate 3-a pointer outside-click dismissal
status: done | updated: 2026-08-27

Goal: close the most user-visible deferred S14b edge — click outside an open
overlay dismisses it — via one protocol event, helper detection, renderer
prop, and select wiring. Protocol v1 discipline: both languages lockstep, new
parity fixture, no snapshot regen (batch-01 untouched).

#### Design (from recon of pinned gpui 35aab21)

- New EventType `outsideClick` (variant-name camelCase is automatic). Wire:
  `{type:event,id,eventType:outsideClick,x?,y?}` — decodeEvent already
carries optional coords generically.
- Helper detection: when a node subscribes OutsideClick, its rendered element
  is wrapped in a tiny custom element (ImeAnchor precedent) whose paint()
  records bounds and registers a next-frame window-level MouseDown listener
  (paint-phase-only API, cleared per frame — no accumulation); Bubble-phase
  press outside the recorded bounds emits the event through the injectable
  sink. Bounds map rebuilds each render frame (no stale pruning debt).
- Renderer: `onOutsideClick` prop → setEventListener; select.Root subscribes
  and maps it to closeMenu() so every select/combobox instance dismisses.
- Testability: gpui TestAppWindow::simulate_mouse_down/up works HEADLESSLY —
  the helper slice gets a real end-to-end test (mount via TestApp, click
  outside → sink sees outsideClick; click inside → nothing) with no window
  server.

#### Slices

1. Protocol both sides + event parity fixture + renderer/select RED→GREEN
2. Helper wrapper element + sink emission (TestApp RED→GREEN, headless)
3. select dismissal unit coverage + deferred-edges test update + README
   deferral wording
4. Full gates + cross-language + independent review; close block

#### Verification

- RED observed on every layer before its GREEN: TS fixture decode rejected
  `outsideClick`; the outside-click suite failed with no listener registered;
  Rust fixture test failed on the f64 canonical-form trap (fixed by writing
  `401.0`/`93.0` — the known serde lesson); the helper TestApp test failed
  with zero emissions until the detector existed, then caught its own test-
  setup bug (a TEXT child ignores size styles → bounds 1920×26) before going
  green with a real 100×100 DIV.
- Headless end-to-end proof: mount → paint registration →
  `simulate_mouse_down(300,300)` emits exactly one outsideClick with
  position; second frame re-registration → press at (50,50) emits nothing
  (crates/helper/src/host.rs, `headless_render_tests`).
- Cross-language: `event-outside-click-01.json` parses and re-emits
  byte-exact in Rust and decodes in TS; `EventType` union + EVENT_TYPES +
  Rust enum variant in lockstep; no fixture-snapshot regen owed (batch-01
  untouched).
- `bun run test` 231 pass / 0 fail across 24 files (select deferral test
  updated: composition assertions retained, outside-click wording now
  shipped); `bun run typecheck`, both consumer typechecks, `check:release`,
  `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`,
  and full locked protocol+helper suites all green (only the known block
  v0.1.6 future-incompat note remains).

#### Review outcome

- Independent review (full envelope, status success, confidence high) verdict
  **MERGEABLE**: event sets 17/17 in lockstep, fixture byte-exact round trip,
  snapshot untouched, paint-only next-frame-cleared registration verified
  against pinned gpui source (window.rs:4848-4861), wrap-after-overlays
  confirmed, helper-owned refusal intact both sides, all commands green
  (231 bun tests, helper/protocol cargo suites, clippy, fmt, tsc).
- One comment-only should-fix applied: select.Root comment now states that
  anchored-menu presses DO emit outsideClick and why Bubble ordering makes
  that safe. Reviewer suggestions also applied: the headless test now
  asserts non-accumulation directly (3 frames → exactly 2 events), the
  Bubble-over-Capture rationale lives on the detector doc comment, and the
  ROADMAP Gate 3 bullet is annotated headless-landed with GUI evidence still
  owed.
- Open Gate 3 remainder (not this slice's debt, recorded by reviewer):
  focus transfer/restoration, keyboard-nav hardening, IME-composition-safe
  arrows, generic popover positioning/clipping, and per-OS GUI evidence.

#### Verification

- RED observed twice before implementation: `utilities.test.ts` failed on the
  missing module; `class-prop.test.ts` failed on missing merge/diagnostic
  behavior (class produced nothing, className stayed silent, variants absent).
- First GREEN attempt regressed four existing suites (phantom empty
  hover/active/dragOver setStyle ops per style touch); fixed by refusing
  empty-vs-undefined layer emissions; suites re-ran green before proceeding.
- `bun run test` 225 pass / 0 fail across 23 files (was 198 pre-slice);
  `bun run typecheck`, `bun run check:consumer-jsx`, `bun run check:release`,
  and `git diff --check` exited 0.
- Real-helper proof: class-compiled styles (spacing + palette + variant
  layers + radius) acked with an honest applied count through `--stdio`
  (transport); `smoke:consumer-jsx` compiled `class="p-4 flex gap-4
  hover:bg-blue-500"` through the universal plugin and the helper acked it on
  both Bun and Node legs; `smoke:consumer-h` still green.
- Matrix doc `docs/tailwind-subset.md` documents every supported family, the
  exact deviation policy, and the refusal list; README's limitation bullet now
  points to it instead of claiming Tailwind is wholly unsupported.

### 2026-08-27 - Gate 3-b overlay focus transfer and restoration
status: done | updated: 2026-08-27

ROADMAP Gate 3 bullet "focus transfer and restoration": today the select
menu is driven entirely by trigger keydown (content is not focusable), and
nothing returns focus when an overlay unmounts — dismissal by selection,
Escape, or outsideClick strands focus on the window.

Design (helper-first, zero protocol surface change):

- Transfer: SelectContent becomes focusable (tabIndex: 0) with the
  EXISTING helper-side autoFocus style (focused one frame after mount via
  autofocus_pending) and routes keydown through the shared handleKey; its
  blur closes the menu. SelectTrigger drops its own blur-close (focus now
  moves into the content on open). Combobox keeps input-owned focus
  (content stays non-focusable; input blur still closes).
- Restoration: when the helper focuses an autoFocus node it records the
  previously focused element (reverse lookup over focus_handles by
  is_focused). When that overlay node is removed (removeChild/
  destroyElement) and the previous element is STILL MOUNTED (stale handles
  are never pruned — tree.get must gate), focus is restored to it via the
  same one-frame defer as autofocus. No previous / dead previous → focus
  falls to the window (documented web-like behavior).

Slices:

1. [x] RED: Rust TestApp test — mount trigger(tabIndex) → focus_element →
   attach content(autoFocus) → draw → content focused; removeChild+
   destroyElement content → draw → trigger focused again. Negative: previous
   removed in same batch → no restore, no panic. (Both observed RED — compile
   errors on the missing API — then GREEN through the real render path.)
2. [x] RED: JS emission tests — select.Content carries tabIndex+autoFocus+
   onKeyDown+onBlur, trigger registers NO onBlur; combobox.Content lacks
   autoFocus and input keeps onBlur. (toMatchObject failed on the missing
   style keys before the select.ts change; combobox fixture extended with
   Content+Item so the negative assertion has a real content node.)
3. [x] GREEN helper: autofocus_origin pair recorded at the autofocus defer
   (reverse lookup over focus_handles by is_focused; first origin wins for
   stacked overlays); removal hook in main.rs Job::Batch after tree.apply →
   note_element_removed; restoration defers from the next render with
   fire-time guards on BOTH ids (overlay gone AND previous alive — stale
   focus handles are never pruned, the tree is the liveness truth).
4. [x] GREEN select.ts: ContentShell(ownsFocus) split — select transfers
   (tabIndex/autoFocus/keyDown/blur-close on content, trigger blur-close
   removed); combobox content stays inert (input owns focus + blur-close).
   README S14b paragraph + ROADMAP Gate 3 bullet annotated.
5. [x] Full gates + independent review; fixes applied.

#### Review outcome

- Independent reviewer envelope: **MERGEABLE**, confidence high — all 8
  invariants verified (trigger nav closed+open, combobox regression-free,
  restore ordering, origin-before-focus, stale-handle guards, zero protocol
  surface change, hook placement, assertion semantics).
- Should-fix applied (RED→GREEN): deferred callbacks fire in registration
  order, so restore-after-autofocus let a cascading select's dismissal
  restore CLOBBER a fresh overlay mounted in the same frame. The restoration
  defer now registers FIRST; new TestApp test
  `same_frame_dismiss_and_fresh_autofocus_focuses_the_new_overlay` proves
  focus lands on the new overlay with a fresh origin.
- Minors applied: a re-parented (alive) overlay keeps its origin so its
  later real destroy still restores; the autofocus defer replaces only DEAD
  origins (stacked live overlays keep the outermost); `SetRoot` swaps now
  reset both focus-restoration fields (ids restart after remount — a stale
  origin could otherwise focus an unrelated live element).
- Final gates: helper bin 95 tests, protocol suites, clippy -D warnings,
  fmt, bun 232/0, tsc ×3, consumer checks, git diff --check — all green.

### 2026-08-27 - Gate 3-c IME-composition-safe key handling
status: done | updated: 2026-08-27

ROADMAP Gate 3 bullet "IME-composition-safe arrow handling". Today the
helper emits keyDown/keyUp to JS regardless of composition state, and the
Rust-side Enter handler commits+submits mid-composition — so a combobox
navigates its list or submits while the user is still composing (marked
text active), where the web contract (isComposing) keeps those keys for
the IME.

Design (helper-side, zero protocol surface):

- Route emit_key/emit_key_up through the sink (emit_event) like every
  other emission — production behavior identical (sink IS write_event_line),
  and key events become observable in TestApp tests.
- Suppress keyDown/keyUp emission AND the input Enter semantics while the
  element's InputState.marked is Some (composition owns those keys). Key
  bindings (cmd-modified app shortcuts) stay untouched.
- JS side: no change — handlers simply stop receiving mid-composition
  keys. select.test.ts deferral comment updated (composition events stay
  deliberately absent from the protocol).

Slices:

1. [x] RED: TestApp test — first assert (sink receives keyDown) failed
   while emit_key still wrote stdout directly; also caught the TestApp
   artifact (simulate_keystroke("enter") types "\n" via dispatch_input →
   replace_text_in_range — a text-path commit, allowed; the leak filter
   targets KeyDown/KeyUp/Submit only).
2. [x] GREEN: emit_key/emit_key_up route through the sink via shared
   emit_key_event + wire_modifiers (production-identical: the sink IS
   write_event_line); ime_composing(id) predicate guards both plus the
   build_input Enter listener; dead key_event fn removed, its byte-shape
   unit test rewritten over wire_modifiers + the full Event.
3. [x] select.test.ts deferral comment updated (suppression shipped
   helper-side; composition events stay deliberately absent); README + 
   ROADMAP annotated, incl. the Tab/bindings stay-live decision.
4. [x] Full gates (cargo 208 pass / 0 fail, clippy -D warnings, fmt,
   bun 232/0, tsc ×3, git diff --check) + independent review:
   **CLEAN/MERGEABLE**, confidence high, 7/7 invariants verified against
   pinned gpui source (dispatch ordering window.rs:4967, with_simulated_ime
   keystroke.rs:241); 3 nits/questions recorded (Tab named in docs now,
   real-IME GUI evidence owed with Gate 3 exit).
### 2026-08-27 - Gate 3-d real-GUI overlay evidence harness
status: done | updated: 2026-08-28

ROADMAP Gate 3 exit criteria: a REAL GUI fixture opens, navigates, selects,
dismisses, and destroys an overlay without stale focus/listener state.
simulateInput was a synthetic edit bypass; real evidence needs REAL event
dispatch through the live window (gpui exposes pub dispatch_keystroke +
dispatch_event with constructible PlatformInput).

Design: commands simulateKey { seq, key } and simulateMouse { seq, x, y }
in full protocol lockstep; helper dispatches through AsyncContext::
update_window (NO HostView entity lease — dispatch handlers re-enter the
entity and any lease during dispatch is a double-lease abort, proven live
with a backtrace); harness drives a real window over the whole exit
criteria; smoke skips (exit 0) without SOLID_GPUI_GATE3_GUI=1.

Slices:

1. [x] RED→GREEN protocol lockstep (union/list/decode/encode TS; enum +
   validation list Rust; fixtures + round-trips both languages).
2. [x] Helper handlers + main.rs arms; reply carries gpui's dispatch
   handled flag as telemetry.
3. [x] Harness + smoke + package scripts + check:gate3-gui. LOCAL REAL-GUI
   RUN GREEN: open (real Enter; focus event lands on the autoFocus
   content) → navigate (real ArrowDown on the focused content) → select
   (real Enter; value updates; unmount) → reopen (real click) → dismiss
   (real outside press; outsideClick) → clean destroy.
4. [x] THREE production defects found and fixed by the harness:
   - Gate 3-a gap: "outsideClick" was missing from the Rust wire
     VALIDATION list (the enum variant alone was not enough) — real
     setEventListener batches were REJECTED cross-process; accept/reject
     regression tests added.
   - Gate 3-b: restore must fire on DETACH, not just destroy — the
     renderer's Show unmount emits removeChild only (retain-all); the
     TestApp tests now use the real wire shape.
   - Gate 3-b: a render-deferred restore marks is_focused but synthetic
     keystroke dispatch never re-reaches the element (handled stays
     false; focus transitions do not revive; TestApp never dispatches
     synthetic keys to div listeners at all). Restore is now IMMEDIATE
     at batch-apply via handle_element_removed (command-context focus —
     the proven path). The synthetic-keystroke anomaly itself stays OPEN
     (pointer dispatch healthy; real keyboards unverified) and is
     recorded in README/ROADMAP.
5. [x] Full gates: cargo 212/0, clippy -D warnings, fmt, bun 234/0,
   tsc ×3 + three consumer/GUI typechecks, both real-helper smokes,
   git diff --check.

#### Review outcome

First reviewer pass: **NOT MERGEABLE** — the main.rs batch hook still
called note_element_removed (return-only; the immediate focus never
happened on the production path — dead-code clippy caught it), clippy
red, and the TODO file had been truncated by a bad edit. All three fixed:
hook now calls handle_element_removed(child_id, window, cx); clippy
clean; TODO restored from Git and this block rewritten.

Second reviewer pass: wire-path focus restore VERIFIED fixed (single
shared entry point for tests and production), all gates green — but the
harness truncated TODO again mid-review (Solid 1 spike block lost,
+59/−16), so the verdict held NOT MERGEABLE on artifact integrity alone.
This restoration rebuilds the file as Git HEAD + this block; nothing
else differs.
### 2026-08-28 - Gate 3-e generic popover anchoring
status: done | updated: 2026-08-28

ROADMAP Gate 3 bullet "positioning, clipping, and window-edge behavior
for generic popovers". Today apply_overlays hardcodes snap_to_window
(clamp) with no offset; gpui's Anchored already ships SwitchAnchor (the
DEFAULT — web-style flip) plus offset(Point).

Design:

- Style keys anchorOffsetX / anchorOffsetY (number = px) and anchorFit
  ("flip" | "snap"). Style keys are an open runtime set — lockstep =
  TS StyleKey union + helper reads + docs; no wire-op changes.
- apply_overlays: offset from the two keys; anchorFit "snap" keeps
  snap_to_window, "flip" (and the new DEFAULT when unset) uses gpui's
  SwitchAnchor — select menus near the window bottom now flip above
  instead of clamping over the trigger (behavior change, documented).
- Deferred already escapes ancestor clipping; window-edge fit is the
  anchor's job. README gains the popover anchoring section (modes,
  offset, fit, deferred/clipping).
- Menu-bar separation bullet: verified satisfied by existing P9
  (stdio_window set-menus test) and P4 dialog tests — annotate
  ROADMAP instead of new work.

Slices:

1. [x] RED→GREEN: Rust pure fns anchor_offset_from_style /
   anchor_fit_from_style + unit tests; apply_overlays mapping (default
   flip); TS StyleKey union + a compile/decode assertion.
2. [x] README popover anchoring section + ROADMAP annotations
   (positioning landed; visual GUI verification owed; menu-bar
   separation verified via P4/P9 tests).
3. [x] Full gates + independent review: first pass held NOT MERGEABLE
   on artifact integrity only (the harness truncated two historical
   blocks mid-review) with code/gates clean; the file was rebuilt from
   Git HEAD + this block and the missing ROADMAP menu-bar annotation
   restored. Code verdict CLEAN; artifact now +62 lines vs HEAD.
The harness truncated the file AGAIN during the re-review (three
historical blocks deleted; the second pass held NOT MERGEABLE on
artifact integrity alone). This commit restores Git HEAD + this block;
integrity is protected by committing immediately.
### 2026-08-28 - Gate 5-a version reporting and remount-after-poison
status: done | updated: 2026-08-28

Gate 5 headless-first slice. Much of the crash/exit contract was already
tested (client.test.ts: reject after death, kill mid-await, close→exit 0,
spawn failure; wire-safety.test.ts: death poisons, applyFailed poisons
with honest counts, dispose still closes cleanly). The remaining gaps:

1. [x] Version reporting: getStats now carries helperVersion
   (CARGO_PKG_VERSION) and protocolVersion (PROTOCOL_VERSION=1) —
   additive payload keys; client test asserts both through the real
   helper (window mode, with the standard GUI skip guards).
2. [x] Remount-after-poison on the SAME connection: the test exposed a
   real contract hole (a fresh renderer's restarted ids collide with
   retained orphans; the old poison-and-remount policy had no working
   primitive). Recovery is now the tested resetTree command (clears the
   retained tree + every per-element state map) followed by a fresh
   renderer mount, asserted through a real ack.
3. [x] Docs: packaging.md "Diagnostics, logging, and versions" section
   (stdout = protocol only, stderr = diagnostics, getStats versions,
   resetTree recovery contract needing a FRESH renderer instance);
   ROADMAP Gate 5 bullet annotated (headless slice landed; per-OS GUI +
   hosted evidence owed).
4. [x] Full gates: cargo 214/0, clippy -D warnings, fmt, bun 237/0,
   tsc ×3 + three consumer/GUI typechecks, git diff --check.

#### Review outcome

First pass: code/lockstep/gates clean; NOT MERGEABLE on artifact
integrity only (the session harness truncated three historical blocks
again) plus two should-fixes and two nits, all applied: window-mode
getStats test now carries the standard skip guards and lives in the
window-mode describe; the reset_tree doc comment no longer contradicts
the code (sink/overlay survive, everything per-element resets);
packaging.md wording now says a FRESH renderer instance (a poisoned one
stays poisoned). This block was rebuilt from Git HEAD; Git now protects
the record.

Second pass (after fixes): all six gate commands green on the fixed
tree; the integrity finding resolved (this diff is pure additions vs
HEAD); should-fixes and nits applied as described. Verdict recorded by
the author per the reviewer's stated re-run condition ("re-run bun test
+ typecheck; then CLEAN/MERGEABLE").
### 2026-08-28 - Gate 6-a representative-fixture measurement
status: done | updated: 2026-08-28

Gate 6 requires measurement against a REPRESENTATIVE consumer fixture
before any optimization talk, reported as p50/p95/p99 with sample sizes,
versions, OS, and headless/GUI status. The existing benchmarks cover the
seven boundaries with synthetic shapes; none measures the Gate 0 screen.

Design: scripts/benchmark-consumer.ts — the Gate 0 SaaS screen on a real
helper (transport mode, headless): mount ack latency, then per-action
signal→flush→ack latency distributions (increment, edit query, choose
option) with warmup + bounded samples; environment block carries
bun/node/platform/arch + helperVersion/protocolVersion via getStats.
docs/performance.md records the first dated report + reproduction
commands; ROADMAP Gate 6 annotated (no CI thresholds per policy).

Slices:

1. [x] benchmark-consumer.ts + package script; local run green — n=100 per
   interaction: increment p50 0.046/p95 0.120/p99 0.177 ms; input-edit
   0.056/0.075/0.086; option-select 0.145/0.183/0.245. Exposed and fixed a
   diagnostics gap: getStats now answers version-only in TRANSPORT mode too
   (headless launchers can verify versions without a window; client test).
   INTENTIONAL CONTRACT CHANGE: transport getStats was previously
   Unsupported — the Rust stdio integration test and the client
   unsupported-error test were updated to the new contract (getStats
   answers versions; setTitle still rejects), so both languages document
   the same behavior.
2. [x] docs/performance.md consolidated dated report across all seven
   boundaries (headless-labeled); ROADMAP Gate 6 annotated.
   Review pass 1: code/gates clean; NOT MERGEABLE on artifact integrity
   only (the session harness truncated the Gate 5-a block again) plus a
   real should-fix — option-select mixed no-op flushes into its
   distribution because the random color sometimes equaled the current
   value. Fixed: deterministic alternation between two distinct colors,
   so every measured flush carries real mutations. The harness
   truncation was repaired by rebuilding Git HEAD + these blocks; Git
   protects the record.
3. [x] Full gates re-run green after fixes (cargo 214/0, bun 238/0,
   typecheck, three consumer/GUI typechecks, git diff --check).
   Second review pass condition: TODO pure additions + reproducible
   option-select distribution.

### 2026-08-28 - Gate 5-b update/rollback policy + manual keyboard probe
status: done | updated: 2026-08-28

Two closing items for the recorded debts:

1. Gate 5 docs bullet "update/rollback expectations": packaging.md gains
   the explicit policy — upgrade and rollback are the same whole-bundle
   operation; launchers MUST verify the pairing via transport getStats
   (protocolVersion + helperVersion) before first use and abort with
   guidance on mismatch; support diagnostics = stderr log + versions.
2. Real-keyboard verification (Gate 3-d "unverified"): a MANUAL probe —
   scripts/manual-keyboard-probe.tsx opens a real window with on-screen
   instructions (select open/navigate/select/escape; combobox typing with
   IME composition while the menu is open), a live on-window event log,
   and JSON event lines on stdout. The human types with a real keyboard;
   Gate 3-c suppression and dispatch behavior become observable. Not
   automatable (that is the point — synthetic dispatch is the anomaly).

Slices:

1. [x] packaging.md policy section (done above when this block was written).
2. [x] manual-keyboard-probe script + package script; verify it mounts and
   renders instructions (auto-quit env for a smoke pass).
3. [x] ROADMAP Gate 3 open item now points real-keyboard verification at
   `bun run probe:keyboard` (human-in-the-loop). Gates green (bun 238/0,
   typecheck, clippy, fmt, git diff --check); probe smoke: mounts, prints
   PROBE READY, window stays open for interaction.

4. [x] REAL-KEYBOARD VERIFIED (human-in-the-loop): the user ran the probe
   on macOS, followed the on-screen steps (select open/navigate/select/
   escape; combobox typing with Vietnamese Telex while the menu was open),
   and confirmed the behavior matched expectations. First run exposed a
   REAL product default bug: gpui's default text color is black and
   unstyled windows paint no background — every unstyled GUI rendered as
   invisible black-on-black text (headless tests never look). Fixed in
   HostView::render: the frame is wrapped in the placeholder's dark
   surface (#1e1e2e) with a light default text color (#cdd6f4); consumer
   styles override per element. Visually confirmed by the user on the
   re-run.

5. [x] ANOMALY RESOLVED — it never existed in the shipped design. A
   discriminating GUI probe (down/escape/enter after dismissal) proved
   the immediate restore keeps synthetic dispatch fully healthy: every
   key lands on the restored trigger, and later autoFocus cycles behave
   (menu reopens, focus transfers). The handled=false readings belonged
   to the removed deferred-restore design and were misattributed by the
   earlier probes (all used escape, run before the redesign). ROADMAP/
   README/probe records corrected; the harness reopen returned to a real
   Enter keystroke; stale records scrubbed.

### 2026-08-29 - SolidJS 2.0.0-rc.4 research + bump
status: done

User request: SolidJS shipped 2.0.0-rc.4 — research it and update the
compatibility policy.

Findings (tarball-level diff vs rc.3, all four crates released):
- solid-js: `createComponent` byte-identical; types gain additive
  patch-channel exports (registerPatch/registerRowOps/registerSlotPatch,
  store predicates) we do not use; dist/dev.js adds a hydration
  live-takeover latch, a semantics-preserving lazy `For` (mapArray under
  the captured owner + `$ll` fast-path marker), and a DEV-only console
  footer; dependency floor moves to @solidjs/signals rc.4.
- @solidjs/universal: ONLY the peerDep bumps to ^2.0.0-rc.4 — code
  identical to rc.3.
- @solidjs/babel-plugin: hydration scope-wrap for function children
  (solidjs/solid#3068 follow-up) + patch-channel hardening — both off
  our `generate: "universal"` path (no SSR/hydration, no patchDriver).
- @solidjs/signals: engine-wide patch/optimistic-store hardening; the
  surface we use (flush/createRoot/createSignal/createEffect/createMemo/
  context hooks) unchanged.
- babel-preset-solid has NO rc.4 (stays 2.0.0-rc.2); we do not use it.

Slices:

1. [x] Bumped root + packages/solid deps to rc.4 (universal/web/babel-
   plugin/signals). First run: 237/238 — consumer-h failed with ZERO
   mutations after an action: packages/solid/package.json still pinned
   rc.3, so bun installed TWO solid-js copies (root rc.4, workspace
   nested rc.3) and cross-copy reactivity silently died. Lockstep fix in
   packages/solid/package.json resolved one copy; rc.3/rc.1 entries
   pruned from bun.lock.
2. [x] Gates on rc.4: bun 238/238 (incl. reactivity-live proofs,
   regressions, select, animation, wire-safety), tsc x3, smoke:node OK,
   example/counter:tsx window opened and real clicks drifted the button
   label/geometry (reactivity live end-to-end on the real helper).
3. [x] ROADMAP compatibility policy now names rc.4 Supported with the
   diff-review rationale + the BOTH-package.json lockstep rule; README
   versions updated to rc.4. Review pass 1: MERGEABLE; both should-fix
   doc corrections applied; a mid-session TODO truncation (harness) was
   rebuilt from HEAD.

### 2026-08-29 - Positioning + ecosystem research follow-ups
status: active

User asked for floem + gpui-component research and a self-review (analysis
delivered in chat; per user request the research itself is NOT recorded here).

1. [x] README "Why this exists": positioning vs all-Rust stacks (Floem/Iced/
   Slint) and in-process GPUI script hosts (gpui-shell) — isolation, unchanged
   Node/Bun toolchain, Solid reactivity; costs stated honestly.
2. [x] setTheme semantic tokens command shipped (protocol additive, full
   lockstep): open token set (unknown → `ignored` in reply), color values
   parsed apply-side, all-or-nothing on bad color, window-scoped (survives
   reset_tree), transport mode Unsupported, cx.notify() repaint per review
   major, theme.set(connection, tokens) helper, README Theming section.
   Review pass 1 NOT MERGEABLE (missing notify; reset_tree doc hijacked;
   false #rgb docs claim) — all fixed; a captureFrame-based repaint proof
   was deleted honestly (xcap screenshots made it a cannot-fail test) in
   favor of a deterministic end-to-end reply test.
3. [x] dumpTree shipped (protocol fixture + parity tests, e2e window test
   against batch-01's settled shape, packaging.md diagnostics entry) and
   examples/gallery.tsx shipped (`bun run example/gallery`): buttons with
   hover/active layers, transitionMs animation, controlled input, select,
   markdown, scroll area, and a REAL setTheme light/dark toggle as the
   theme dogfood. Mount smoke green.
4. [ ] ROADMAP infra notes when relevant: gpui is now on crates.io (0.2.2);
   migration from the pinned zed git rev is a real future path; agent-skills/
   llms.txt style consumer docs once there are consumers.

### 2026-08-29 - README/ROADMAP rewrite (pi-style OSS docs)
status: done

User asked to rewrite both docs simpler, learning from earendil-works/pi's
OSS style (one-line pitch, quickstart-first, plain language, explicit
non-goals, details pushed to docs/).

1. [x] README: 328 → 207 lines, zero internal gate codes (S14/P9/P11/Gate-N
   decoded to plain words). Order: pitch + diagram → status → quickstart
   (npm path) → the SSR trap → why-this-exists → what-works (one section
   with the four feature snippets instead of five scattered gate-narrative
   sections) → how-it-works → trust boundary → version compat → packages →
   development commands → docs table → limitations. All facts kept: helper
   resolution order, Babel config, engines, poison semantics, macOS-only
   helpers, compaction-not-adopted.
2. [x] ROADMAP: 396 → 139 lines. North star + works-today/direction/not-yet
   kept; "Done" merged with the old evidence prose (human-in-the-loop probe
   included); "Next" reduced to five ordered items (hosted per-OS GUI
   evidence, Linux/Windows packaging, signing/clean-machine, first real
   consumer, deferred-by-evidence); guardrails and version pins kept;
   research links kept. Cross-references checked (no doc linked into
   removed README anchors).
