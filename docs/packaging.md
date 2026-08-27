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

## Version compatibility and upgrades

- `@solid-gpui/helper-*` packages are pinned **exactly** by
  `@solid-gpui/client`'s optionalDependencies, and `scripts/check-release.mjs
  --tag` gates releases on that pin — never mix helper and client versions
  across a minor boundary when upgrading an app: replace the whole bundle.
- The helper exits 0 on stdin EOF and the client rejects all pending sends the
  moment the process closes (poison, no requeue); launchers should still
  SIGTERM the sidecar on forced quit as belt-and-suspenders
  (`connection.kill()`).

## Explicitly not yet

- Windows/Linux app packaging: waits on hosted **GUI** runtime evidence per
  ROADMAP, not merely a successful compile.
- Bun `--compile` single-file: an experiment, never the baseline — an adjacent
  or extracted helper must be proven on a clean machine (launch, first render,
  input, teardown) before the word "single-file" is used.
- Signing itself runs on maintainer machines with user-held certificates; CI
  validates packaging and packaged-binary execution (`release.yml` smoke),
  which is the automated half of this runbook.
