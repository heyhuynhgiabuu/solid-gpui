# Review brief: Solid 2 rc.3 compatibility migration

## Goal
Audit the current uncommitted diff for the Solid 2 rc.3 migration and follow-up JSX `memo` fix. Return a severity-ranked, independent verdict. Do not edit files.

## Parent context
solid-gpui renders Solid 2 trees through @solidjs/universal into an out-of-process Rust GPUI helper. P1–P11 are complete; P12 protocol compaction remains intentionally benchmark-gated. The candidate moves the JS layer from Solid 2 rc.1 plus `babel-preset-solid` rc.2 to exact `solid-js`, `@solidjs/universal`, `@solidjs/web`, and `@solidjs/babel-plugin` 2.0.0-rc.3. It changes the Bun Babel preload and compile-surface contract, with no intended Rust/protocol changes.

An earlier review found a real gap: rc.3 emits `{ memo as _$memo }` for dynamic JSX ternaries, but `packages/solid/src/jsx.ts` did not export `memo`; `examples/menus.tsx` then failed at module load. The parent added a RED compile-surface fixture containing a ternary and then exported `createMemo as memo`; the targeted JSX test and real menus smoke now pass. rc.3 universal also calls `cleanupNodes` on disposal, so `packages/solid/src/renderer.ts` now destroys the full shadow subtree (including helper-owned refused descendants), clears handlers, and retains a shadow-guarded fallback for older universal builds.

## Proposed changes to assess
1. Exact rc.3 dependency alignment and replacement of the old preset with the official Babel plugin.
2. Module-level JSX runtime export of compiler-generated `memo`, with a dynamic-ternary compile-surface regression test.
3. rc.3 cleanup/disposal handling without double-destroying roots, leaking refused descendants, or poisoning the protocol.

## Scope and references
Review `git diff HEAD`, especially:
- `package.json`, `packages/solid/package.json`, `bun.lock`
- `scripts/solid-jsx-preload.ts`
- `packages/solid/src/jsx.ts`, `packages/solid/src/jsx.test.ts`, `packages/solid/src/renderer.ts`
- `README.md`, `.pi/MEMORY.md`, `.pi/artifacts/TODO.md`
Also inspect installed exact rc.3 package manifests/source, `examples/menus.tsx`, existing renderer/regression tests, and confirm no Rust/protocol drift. The current worktree is authoritative.

## Non-goals
Do not edit, stage, commit, push, install packages, alter generated files, redesign GPUI/NDJSON, or reopen P12. Separate pre-existing issues from migration regressions.

## Write/read policy
Read-only. Safe targeted tests are allowed. Do not use `/tmp` for logs or leave processes running.

## Acceptance and stop condition
Review the whole diff and compiler/runtime/cleanup seams. The final response must be the last message and must begin with an explicit `CLEAN/MERGEABLE` or `PARTIAL/BLOCKED` verdict, list findings with severity and `path:line` evidence, and state whether blocker/major/important findings remain. Do not stop at an intermediate thought or tool call.

## Existing verification evidence
The parent freshly ran: `bun run test` (171 pass, 0 fail), `bun run typecheck` (exit 0), `bun run smoke:node` (exit 0), `bun run check:release` (exit 0), `bun run pack:all` (all three packages built/packed), `cargo test -p solid-gpui-protocol -p solid-gpui-helper` (84+2+1+22 Rust helper and 37+39 protocol tests pass), `cargo clippy --all-targets -- -D warnings` (exit 0), `cargo fmt --all -- --check` (exit 0), and real JSX counter/text-runs/menus smoke probes (exit 0). The parent also verified `bun install --frozen-lockfile` and no stale rc.1/rc.2 references in candidate surfaces. A broad root diagnostics scan reports pre-existing missing Node/Bun declaration errors; package `bun run typecheck` is the authoritative green gate.

## Independent verdict

Reviewer `mta1z9zq-a07c` returned **CLEAN/MERGEABLE** after inspecting the complete
candidate and the installed rc.3 sources. No blocker, major, or important finding
remained. The reviewer confirmed the earlier missing `memo` export was fixed and
that the cleanup hook preserves refused-child teardown. An earlier isolated window-server run briefly reported one frame, but the
subsequent full suite returned 171 pass / 0 fail with 31 frames; the migration
has no Rust/protocol diff.
