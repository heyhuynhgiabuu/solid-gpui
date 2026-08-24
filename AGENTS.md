# AGENTS.md — solid-gpui

**Read [README.md](./README.md) first.** This file tells you how to work here
without breaking things. Every "do not" below exists because a review or probe
caught the exact bug it prevents. Violating them is how this repo dies.

## What this project is

Solid 2 components rendered by **Zed's GPUI** through an **out-of-process**
Rust helper:

```
Solid reactivity → NDJSON mutation batches (stdio) → retained tree → GPUI frame
     (Bun/Node)         @solid-gpui/client           crates/helper      Metal
```

Out-of-process is a deliberate architecture decision (`.pi/artifacts/DECISIONS.md`,
ADR 002): the helper owns its main thread and native event loop, so there is no
Zed fork, no ThreadsafeFunction, and one code path per OS. Do not "simplify" it
into an in-process addon.

## Clean-room rules (legal, non-negotiable)

- This project was inspired by the *idea* of an existing unlicensed JS↔GPUI
  bridge. Ideas and architecture are fair game; that project's code, files,
  diffs, and commits are NOT — it has no license, so everything in it is all-
  rights-reserved. Never copy from it, never depend on its packages.
- Rich text/markdown/diff rendering will be ported from [Comet] (MIT) with
  attribution headers — that is the legal source for those subsystems.

[Comet]: https://github.com/zeronsh/comet

## Commands

```sh
bun install                                # after changing workspace deps
bun run test                               # ALL bun suites (--conditions=browser, see trap below)
bun --conditions=browser test packages/solid   # one package
bun run typecheck                          # tsc ×3 (protocol, client, solid)
cargo test -p solid-gpui-protocol -p solid-gpui-helper
cargo clippy --all-targets && cargo fmt --all -- --check
bun run smoke:node                         # client under real Node 24
bun run demo:solid                         # counter window (~4 s, GUI)
```

GUI tests open real windows. Set `SOLID_GPUI_SKIP_GUI_TESTS=1` on headless CI.

## THE TRAP: solid-js resolves to non-reactive SSR stubs by default

`solid-js@2` maps the default `node` condition to `dist/server.js` — SSR stubs
with **no reactivity** (upstream [solidjs/solid#2569]). Effects run once at
mount, then silently never again. No error. No warning. Your UI just freezes.

Every entry point that touches Solid MUST pass `--conditions=browser`
(`bun --conditions=browser …`). It is already encoded in the root `test`
script, the `solid` package script, and `demo:solid`. If you add a new script,
command, or CI job that imports solid-js, encode it there too — then prove
reactivity is live (a signal set must produce new mutations within `flush()`).

[solidjs/solid#2569]: https://github.com/solidjs/solid/issues/2569

## Architecture invariants (violating these broke the app before)

1. **Validation and rendering agree.** If the renderer would silently drop it
   (e.g. children of text nodes), validation must reject it — otherwise the
   ack's `applied` count lies. (`crates/protocol/src/retained.rs`)
2. **Parentless ≠ acyclic.** A parentless *ancestor* (the root!) appended into
   its own descendant creates a cycle. `attach` walks ancestors and enforces
   `MAX_DEPTH = 256`; render recursion depends on that bound. Do not remove
   either check. (`retained.rs`, Slice 4 review Major)
3. **Mirror attach semantics on both sides of the wire.** Universal's
   `reconcileArrays` moves call `insertNode` for nodes *already* in the parent;
   our shadow tree must retain-before-splice exactly like the Rust `attach`.
   Skipping the retain grew duplicate entries and emitted invalid duplicate
   `removeChild`s. (Slice 5 review Critical)
4. **A failed batch poisons the renderer.** Mutations are spliced before send;
   a rejection means shadow and wire MAY have diverged. Re-sending could
   double-apply leading mutations. Poison (reject future flushes) and remount.
   Do not add requeue logic without redesigning apply idempotency.
5. **The container is virtual.** `#root` never crosses the wire. Mounting emits
   `setRoot`; a second mount destroys the previous root before setting the new
   one (otherwise old subtrees leak forever).
6. **Unknown style keys are accepted; unknown event types are errors.** Style
   keys are forward-compatible; events require the helper to know them. Keep
   the two closed/open sets distinct — they are not symmetric by accident.
7. **ElementId 0 does not exist.** Ids are 1..=2^32-1 on both sides. Report
   wire numbers at full width: `got as u32` once truncated 4294967298 → 2.

## Cross-language contract discipline

The protocol lives twice (TS + Rust). Any change must:

1. Update both implementations and both error taxonomies in lockstep
   (`invalidJson / unsupportedVersion / unknownOp / unknownEventType /
   unknownElementType / invalidShape`; replies: `ack / error{decodeFailed,
   applyFailed}`).
2. Regenerate the emission snapshot:
   `cargo test -p solid-gpui-protocol regenerate_rust_emission -- --ignored`
   then commit `packages/protocol/fixtures/rust-emitted-batch-01.json`.
3. Keep fixtures parseable by BOTH languages — they are the cross-language
   test. Never hand-tweak a fixture without regenerating its snapshot.
4. Compact JSON via `to_json(from_json(...))`, never whitespace stripping —
   stripping corrupted UTF-8 string contents once.

Serde notes that bit us: enum-level `rename_all` renames variant NAMES only;
variant fields need their own `#[serde(rename_all = "camelCase")]`.
`StyleValue::Number` wraps `serde_json::Number` on purpose (f64 mangles ints).

## Solid/universal gotchas

- `@solidjs/universal`'s exported `render()` returns a bare disposer and does
  NOT run `cleanupNodes` on dispose (rc.1; verified byte-identical dev/prod
  builds). Our wrapper owns disposal: base disposer + explicit destroy of the
  mounted root, guarded by the shadow map against double-calls.
- Solid 2 defers effects through its own scheduler. Our `flush()` drains
  solid's queue FIRST (`flushSolid()`), then pumps microtasks until quiescent,
  because component results resolve in stages. A single synchronous drain loses
  everything past stage one.
- `rgb(hex)` in gpui drops the TOP byte of a u32. 8-digit colors must go
  through `rgba()`. (`crates/helper/src/host.rs::parse_color`)
- UPDATE 2026-08-24: upstream gpui HAS `overflow_scroll()` again
  (`Styled`, div.rs ~1474) plus `ScrollHandle`/`track_scroll()` — our
  S8 maps `overflow` style keys onto those. The old "clips for now" note
  applied to an older checkout.

## Coding standards (adapted from Zed's `.rules`)

- Correctness and clarity first; speed second unless measured otherwise.
- Comments explain **why**, never what. No organizational narration.
- Prefer existing files; new files only for new logical components.
- No mod.rs; name crate roots descriptively (`gpui.rs` style is fine for bins).
- Rust: no `unwrap()` on input paths; no indexing that can panic; no `let _ =`
  on fallible operations (propagate with `?`, log with intent, or handle).
- TypeScript: strict mode, no `any`; non-null `!` assertions only for
  invariants validated within the same function — never across module
  boundaries or on decoded wire data. Decode all untrusted JSON at the
  boundary via `decodeBatch`/`decodeReply` — raw `JSON.parse` results never
  reach core logic. Recoverable failures are `Result`, not throws.
- Zero runtime dependencies in `protocol` and minimal in `client`
  (`node:child_process`, `node:readline` only). Adding a dependency requires a
  written justification in the PR description.
- `import.meta.dir` is Bun-only. Use `fileURLToPath(new URL(".", import.meta.url))`
  for Node compatibility.

## Testing protocol

- TDD: RED (observe the failure) → GREEN (minimum change) → refactor. A test
  that cannot fail is not a test. Compile errors count as RED only for brand-
  new APIs; behavior changes need an observed assertion failure.
- The shared fixtures (`packages/protocol/fixtures/*.json`) are parsed by BOTH
  language suites. Changing one without regenerating its Rust-emitted snapshot
  breaks the cross-language guarantee — that is intentional, do not weaken it.
- New protocol behavior needs a regression test named after the bug it prevents.
- Before claiming done: full suite green, `tsc` ×3, clippy, fmt, and an
  **independent review** (another agent or human — never the author) for any
  slice-sized change. Unresolved major+ findings keep the slice open.

## Git

- Imperative commit subjects scoped by area: `feat(solid): …`,
  `fix(protocol): …`, `chore(artifacts): …`.
- One logical change per commit; artifacts (`.pi/artifacts/*`) may ride along
  or trail separately.
- Apache-2.0 headers on new source files; LICENSE stays at repo root.
