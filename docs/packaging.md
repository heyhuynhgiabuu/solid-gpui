# Packaging an application (Gate 4 baseline)

How to ship a solid-gpui app as a native bundle with a **helper sidecar**, per
the ROADMAP Gate 4 distribution baseline. The npm packages remain the library
path; this document is the application path.

## The launcher contract

The launcher (your app's entry point) owns two environment variables and must
set them **before** any code spawns the helper:

```js
import { dirname, join } from "node:path"

// Resolve the sidecar relative to the installed application. For a Node
// launcher, process.execPath is the real on-disk binary; for a `bun build
// --compile` executable, process.execPath is the compiled binary itself.
const sidecar = join(dirname(process.execPath), "..", "Resources", "solid-gpui-helper")

process.env.SOLID_GPUI_HELPER = sidecar
process.env.SOLID_GPUI_NO_DEV_FALLBACK = "1" // never pick up a dev build
```

With `SOLID_GPUI_NO_DEV_FALLBACK=1`, resolution becomes **production**: the
monorepo `target/debug` arm of the chain is removed entirely, and a missing
sidecar produces a launcher-directed error instead of falling back
(`packages/client/src/binary.ts`). Library users never set this variable and
keep the dev-target convenience.

## Bundle layout (macOS example)

```text
MyApp.app/
├── Contents/
│   ├── MacOS/myapp                  ← launcher (Bun or Node runtime)
│   └── Resources/
│       └── solid-gpui-helper        ← sidecar, mode 0755
```

- Build the helper per target with `cargo build -p solid-gpui-helper --release`
  (Bun's `--target` flag does **not** cross-compile GPUI).
- `node scripts/pack-helper.mjs --target darwin-arm64 --binary <path>` assembles
  a package that already carries the binary mode 0755 — copying into the bundle
  must preserve it (`cp -p`, `fs.cpSync`, ditto). `npm pack` preserves modes.
- The npm model (`@solid-gpui/helper-*` optionalDependencies) stays available
  for library users; an application bundle should ship the sidecar explicitly.

## Package visibility (npm private by default)

All `@solid-gpui/*` packages publish **private** (`--access restricted`,
ADR 008) while the API is a prerelease and the audience is invite-only:

- Installing requires npm auth with access to the `@solid-gpui` scope — an
  org/user invite on the registry, or a granular token with read rights to
  the packages. A stranger's `npm i @solid-gpui/solid` fails E403/E404 by
  design.
- Publishing restricted packages requires a paid npm plan on the publishing
  account; the release secret's account must hold it or publish fails.
- Going public later is a deliberate flip, not a default: change access on
  the registry (package settings) and `--access restricted` → `--access
  public` in `release.yml` in the same commit.

## Signing and notarization (macOS; user-held certificates)

Prerequisites you must own: a Developer ID Application certificate and an
App Store Connect API key (or app-specific password) for notarytool.

```sh
# 1. Sign the HELPER first, after it is placed in the bundle:
codesign --force --options runtime --timestamp \
  --sign "Developer ID Application: <you>" \
  MyApp.app/Contents/Resources/solid-gpui-helper

# 2. Sign the app bundle (seal includes the helper's signature):
codesign --force --options runtime --timestamp \
  --sign "Developer ID Application: <you>" MyApp.app

# 3. Notarize and staple:
xcrun notarytool submit MyApp.app.zip --keychain-profile "ac" --wait
xcrun stapler staple MyApp.app
```

The helper needs no special entitlements (Metal rendering requires none); the
hardened runtime is what matters. An unsigned or ad-hoc helper inside a
signed app is the classic first-launch Gatekeeper kill — the helper is signed
first precisely so the bundle seal covers it.

## Diagnostics, logging, and versions

- The wire protocol owns stdout: every stdout line is protocol (replies and
  events). Diagnostics go to stderr only — a fatal helper error or panic
  appears there; the launcher should capture it into the app log.
- `getStats` carries `helperVersion` (the helper crate's semver) and
  `protocolVersion` (the wire protocol major). Launchers and support tools
  pin and verify against these instead of scraping process output.
- `dumpTree` (window mode) returns the retained tree's shape — id, type,
  parent, children, text per node, depth-first, plus a node count. Styles
  and helper-only state are deliberately omitted: it answers "what does the
  helper THINK is mounted", the first question when a UI looks wrong.
- Poisoned-batch recovery contract: a failed batch poisons the renderer
  (later flushes reject without requeueing — re-sending could double-apply
  a partially applied batch). The sanctioned recovery is `resetTree`
  (clears the helper's retained tree and per-element state so a fresh
  renderer can remount with restarted ids on the same connection),
  followed by a FRESH renderer instance (a poisoned one stays poisoned); or replace the helper process
  for a hard reset.

## Version compatibility and upgrades

- `@solid-gpui/helper-*` packages are pinned **exactly** by
  `@solid-gpui/client`'s optionalDependencies, and `scripts/check-release.mjs
  --tag` gates releases on that pin — never mix helper and client versions
  across a minor boundary when upgrading an app: replace the whole bundle.
- The helper exits 0 on stdin EOF and the client rejects all pending sends the
  moment the process closes (poison, no requeue); launchers should still
  SIGTERM the sidecar on forced quit as belt-and-suspenders
  (`connection.kill()`).

### Update and rollback policy

- Upgrade and rollback are the SAME operation: replace the whole bundle
  (app + runtime + sidecar) with the other version's bundle. Never swap the
  sidecar alone across a minor boundary — the exact pin exists because the
  wire contract and the JS surface move together.
- Before first use after an upgrade OR rollback, the launcher MUST verify
  the pairing: send `getStats` (works with or without a window) and compare
  `protocolVersion` against the major the JS packages were built for and
  `helperVersion` against the pin. On mismatch: abort with guidance
  pointing at docs/packaging.md — a mismatched pair may appear to work and
  then poison on the first unusual batch.
- Rollback of an app update therefore always ships the previous FULL bundle
  (never a new app with an old sidecar, or the reverse). The version pin in
  `@solid-gpui/client`'s optionalDependencies is the single source of truth
  for which sidecar belongs to which client release.
- Crash diagnostics for support: capture the launcher's stderr log
  (diagnostics channel) plus the app's own stdout correlation ids; report
  the helper `helperVersion` from `getStats` with any ticket.

## Linux and Windows platform packages

The helper builds for `linux-x64` and `windows-x64` and the release pipeline
packs them like the macOS ones (`@solid-gpui/helper-linux-x64`,
`@solid-gpui/helper-windows-x64`). Two honest caveats:

- **Linux needs system libraries at runtime.** The npm package ships the
  binary only; the helper links fontconfig, xkbcommon (+x11), EGL/GBM,
  and (for the wayland backend) the wayland/scanner libraries. On Debian/Ubuntu:
  `apt-get install libfontconfig1 libxkbcommon0 libxkbcommon-x11-0 libegl1
  libgbm1 libwayland-client0` (plus the `-dev` set when building from source).
  Gate the app's Linux claim on those being present (see ROADMAP, hosted
  GUI evidence).
- **Windows binaries are unsigned.** SmartScreen will warn on first launch
  until the project holds a code-signing certificate (the macOS signing
  section above is the same story). The client resolves the packaged
  `solid-gpui-helper.exe` automatically on `win32`.

## Explicitly not yet

- Windows/Linux app packaging: waits on hosted **GUI** runtime evidence per
  ROADMAP, not merely a successful compile.
- Bun `--compile` single-file: an experiment, never the baseline — an adjacent
  or extracted helper must be proven on a clean machine (launch, first render,
  input, teardown) before the word "single-file" is used.
- Signing itself runs on maintainer machines with user-held certificates; CI
  validates packaging and packaged-binary execution (`release.yml` smoke),
  which is the automated half of this runbook.
