# S16 review brief (r1) — npm packaging + prebuilt-helper distribution

## Context

Repo: solid-gpui (clean-room OSS; prior-art repo lxsmnsyc/solid-gpui is OFF
LIMITS — do not fetch it). Solid 2 → NDJSON → out-of-process Rust helper →
GPUI. S16 makes `npm i @solid-gpui/solid` work without a Rust toolchain.
Two commits under review:
- 5d0bc08 feat(client): helper binary resolution chain
- 3a252d0 feat(release): npm packaging + prebuilt-helper platform packages

ADR 005 (.pi/artifacts/DECISIONS.md): per-platform npm packages via
optionalDependencies (esbuild/swc model); publish order platform → TS
packages is a hard invariant; no runtime downloads; macOS-only for 0.1.0.

## What changed (verify against diffs, not this list)

1. `packages/client/src/binary.ts` (NEW) + `binary.test.ts` —
   resolveHelperBinary chain: SOLID_GPUI_HELPER env → monorepo
   target/debug (dev flow) → platform package via `deps.resolve(pkg +
   "/package.json", moduleDir)`; guidance error lists what was tried.
   Injected ResolveDeps seams. `defaultBinaryDeps()` wires production
   (createRequire + req.resolve; moduleDir from import.meta.url).
   `client.ts defaultBinary()` now calls it.
   - CHECK: prod wiring correctness under Node AND Bun (createRequire from
     a resolved file path; `resolve(from, "index.js")` trick); no behavior
     change in-repo (target/debug still wins); error paths never leak
     stack-dependent paths into user guidance.
2. `packages/*/tsdown.config.ts` (NEW) + root `build`/`pack:all` scripts —
   per-package dist builds (ESM + dts, workspace deps external).
   Dist committed? NO — built in CI/release. Check .gitignore covers it.
3. `scripts/pack-helper.mjs` (NEW) — platform package assembly
   (os/cpu/files; binary copied uncompressed). Check: os/cpu derivation
   from target string handles darwin-x64/arm64 (and would NOT silently
   succeed for a target it doesn't know — e.g. linux-x64 maps os=linux
   cpu=x64; is that intended? ADR says macOS-only for 0.1.0 — the script
   itself is target-agnostic; the workflow matrix gates what's built).
4. `scripts/pack-package.mjs` (NEW) — staging pack: copies package.json/
   LICENSE/README/dist; rewrites exports → dist entries; pins workspace:*
   deps to the package version; drops scripts/devDeps. Check: the exports
   rewrite covers solid's two entries ("." and "./jsx"); staging copy
   `cp -R dist stage` (fixed from dist/. after the dist/dist bug — verify
   the tarball layout: package/dist/index.mjs etc.).
5. `scripts/check-release.mjs` (NEW) — equality across 3 packages +
   helper optionalDependencies pins; `--tag` match. Exit codes correct.
6. `.github/workflows/release.yml` (NEW) — helper matrix (macos-14 arm64,
   macos-13 x64), version check vs tag, build+pack, smoke with artifact
   binary via SOLID_GPUI_HELPER, publish platform-first then TS,
   no-token validation-only path. CHECK: ordering invariant actually
   enforced by job structure; GITHUB_REF_NAME fallback v0.0.0 would FAIL
   the version check on workflow_dispatch (acceptable? it should —
   dispatch without a tag must not publish); artifact download pattern
   `helper-*` into dist/pack matches publish loop `dist/pack/helper-*`.
7. `packages/client/package.json` — optionalDependencies pins
   helper-darwin-arm64/x64 @0.1.0. `packages/*/LICENSE` copies.
   `README.md` — Install section (claims Bun resolves Solid correctly by
   default — VERIFY this claim is not overstated; if unsure flag it, the
   safe wording is to always pass --conditions=browser).
8. Root `package.json` — devDep tsdown; scripts build/pack:all/check:release.

## Evidence already gathered (re-verify what you can)

- bun run test 111/111; tsc ×3 clean; cargo protocol 28+29 pass (suites
  unchanged); node smoke OK.
- E2E scratch project ~/dev/scratch/s16-e2e-v4 (outside the repo): npm
  install from local tarballs with overrides simulating the registry;
  Node 24 smoke ack {seq:1,applied:2} exit 0; window demo mounted with
  live click events through the platform-package binary. You may re-run
  `node smoke.mjs` there (read-only) but do not modify the repo.

## Invariants to actively check

- A. Publish order invariant is structural (job dependency + sequential
  publish), not documented-only.
- B. The published graph is self-consistent: client's optionalDeps pins =
  helper package versions = TS package versions; check-release enforces
  at CI time.
- C. No behavior change for existing users of render()/mountJsx/h() in
  the monorepo (dev target wins; tests unchanged).
- D. Clean-room: no content sourced from the off-limits repo (the model
  citation is esbuild/swc industry practice).
- E. Security-ish: pack scripts don't copy junk (fixtures, tests, node_modules)
  into tarballs; the helper binary path is not world-writable-dependent
  (chmod preserved by npm); no secrets in workflows.
- F. typecheck/test gates still encode the --conditions=browser trap
  (root test script unchanged).

## Verdict format

CLEAN, or findings as Blocker/Major/Minor with path:line evidence.
Focus: correctness of resolution + publish graph, not styling.
