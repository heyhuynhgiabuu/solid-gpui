# S15 review brief (r1) — JSX pipeline

## Context

Repo: solid-gpui (clean-room OSS). Solid 2 → NDJSON mutation protocol →
out-of-process Rust helper → GPUI. h() hyperscript API exists since S5–S12;
S13 added markdown/syntax/diff. S15 adds the JSX authoring track:
babel-preset-solid `{ generate: "universal", moduleName: "@solid-gpui/solid/jsx" }`
compiles .tsx into module-level calls bound by the new
`packages/solid/src/jsx.ts`. h() must stay untouched and additive.

Two commits under review:
- 8a312c3 feat(solid): JSX pipeline — babel-preset-solid universal runtime + bun preload
- b80078c fix(client): reject oldest pending on seq-less error replies

## What changed (verify against the diff, not this list)

1. `packages/solid/src/render.ts` — extracted shared wiring into exported
   `mount(connection, { onSuite }, code)`; `render()` is a thin wrapper.
   MUST NOT change render()'s observable behavior (existing render.test.ts
   unchanged and green — check the tests still cover the same seams).
2. `packages/solid/src/jsx.ts` — NEW. Module-level runtime:
   `initJsxRuntime(send)`/`resetJsxRuntime()` test seam, `mountJsx(code)` app
   entry, bindings createElement/createTextNode/insertNode/removeNode/insert/
   setProp/effect/createComponent delegating to the suite created inside
   mount() via onSuite. Re-exports Show/For/Switch/Match from solid-js.
   - Key design point: `effect` is a passthrough to universal's echoed
     two-arg effect (NOT custom emulation) — empirically probed to handle
     object-returning computes. Check the delegation is honest (no solid-js
     primitives imported beside universal — MEMORY landmine).
   - `createElement`/`setProp` route via `raw().setProp` (universal consumes
     setProperty internally; setProperty is NOT echoed in rc.1).
3. `packages/solid/src/renderer.ts` — `textOf` coercion in
   createTextNode/replaceText. Root cause fix: compiled `{count()}` hands raw
   numbers; setText is a string op on the wire; Rust serde rejects
   `"text":0` → batch never decodes → hang. Check: no other setText emitter
   lacks coercion (markdown source at renderer.ts ~line 330 already had
   String(value ?? "")).
4. `packages/client/src/client.ts` — onLine now rejects the OLDEST pending
   when an error reply arrives with seq:null (decode-failure framing).
   Rationale: helper cannot echo a seq for a line that never parsed; strict
   line ordering (main.rs replies in read order) makes the oldest
   unsatisfied pending the culprit. Check for regressions: seq:null errors
   with NOTHING pending still route to onUnmatchedReply; result/ack paths
   untouched.
5. `packages/client/src/__fixtures__/fake-helper.sh` + `events.test.ts` —
   regression test for (4).
6. `packages/solid/src/jsx.test.ts` — NEW, 7 runtime tests + compile-surface
   meta-test (compiles representative JSX with the real babel preset,
   asserts every emitted `import { X as _$X }` resolves to a jsx.ts export).
7. `packages/solid/package.json` — exports map gains "./jsx".
   Root `package.json` — devDeps babel-preset-solid@2.0.0-rc.2 + @babel/core
   (justification in commit message), devDep workspace link
   @solid-gpui/solid, script example/counter:tsx (encodes
   --conditions=browser per AGENTS.md trap).
8. `scripts/solid-jsx-preload.ts` — NEW Bun.plugin onLoad (.tsx → preset).
   `examples/counter.tsx` — NEW JSX twin of examples/counter.ts.

## Invariants to actively check

- A. Seam discipline: jsx.ts bindings go through the SAME suite machinery as
  h()/render() — no second wiring of event routing (BYPASSED-SEAM BUG in
  MEMORY). onSuite is the only handoff.
- B. Validation/rendering agreement (invariant #1): nothing here changes the
  protocol or the closed sets; text coercion must happen BEFORE setText is
  queued (it does — in renderer config), so the wire never sees non-strings.
- C. Client fix correctness: is "oldest pending" provably the right target
  under pipelined sends? (main.rs reads a line, applies, replies, then reads
  the next — replies are strictly ordered; a decode error is emitted in that
  same order, so the failing line is the first line WITHOUT a prior reply =
  oldest pending. Verify by reading crates/helper/src/main.rs around the
  reader thread + reply loop.)
- D. TDD discipline: numeric-text test and client hang test were written RED
  first (observed fail) then GREEN — the commit history/patches can't prove
  ordering; instead verify the tests CAN fail (e.g., mentally revert the fix
  and confirm the assertions break).
- E. Clean-room: no code from the unlicensed prior-art bridge; babel usage is
  upstream tooling, fine. Comet (MIT) untouched in this slice.
- F. No `any`, strict-mode clean (bun run typecheck passes), no unused
  imports left from refactors.

## Evidence you can run

- `bun run test` (104/104 expected; GUI tests open windows — set
  SOLID_GPUI_SKIP_GUI_TESTS=1 on headless)
- `bun run typecheck`
- `bun run example/counter:tsx` — window opens, button clicks stream
  `event: click on #5 ...` lines to the terminal (leave it to the user to
  close; kill via pgrep if needed)
- `cargo test -p solid-gpui-protocol` (protocol untouched — sanity only)

## Verdict format

Per-repo convention: verdict CLEAN or findings labeled Blocker/Major/Minor
with path:line evidence. Focus on correctness and seam discipline, not
style. This is r1; unresolved Major+ keeps the slice open.
