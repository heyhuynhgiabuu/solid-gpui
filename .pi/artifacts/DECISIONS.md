# DECISIONS

### 2026-08-24 - Phase 0 session
status: active

#### ADR 001: Clean-room stance toward the prior-art bridge
Decision: Take idea-level architecture only (mutation protocol → retained tree → GPUI frame
build). Never copy the prior-art bridge source or commits, never depend on `@the prior-art bridge/*` packages, never
carry remorses' unlicensed patch commits. Rich text/markdown/diff elements will be ported
from Comet (MIT) with attribution when needed (Phase 3).
Why: the prior-art bridge has no LICENSE (all rights reserved). Idea reuse is legal; expression reuse is not.
User confirmed: no engagement with the prior-art bridge licensing (no issue opened).
Consequences: we solve the macOS event-loop problem ourselves (ADR 002); lower legal risk,
more up-front engineering.

#### ADR 002: Process architecture — out-of-process helper (decided 2026-08-24)
Decision: **Option C.** A helper binary (`@solid-gpui/helper`, Rust, stock upstream gpui via git
dependency) owns its process main thread and native runloop on every OS. The JS side speaks a
transport-agnostic mutation protocol; v1 transport is IPC (UDS preferred, stdio fallback),
newline-delimited JSON, one write per batch. The package spawns and supervises the helper
(restart on crash, cleanup on exit).
Why: no zed fork/patch queue to maintain; no ThreadsafeFunction usage (sidesteps Bun #36828
open deadlock and post-1.4.0 #39810 fix timing); uniform macOS/Windows/Linux story; helper
process survives `bun --hot` JS remounts naturally.
Consequences: one IPC hop per batch (batched mutations → sub-ms; measured in Slice 3 before
committing to JSON vs binary framing); two-process debugging (helper gets a `--foreground`
flag); process supervision code in `@solid-gpui/solid`. When zed#63077 (embed runloop) merges,
an in-process napi backend can be added behind the same protocol interface without design change.

#### ADR 003: License — Apache-2.0 (decided 2026-08-24)
Decision: Apache-2.0 for the whole repo (LICENSE + headers).
Why: patent grant; matches gpui family (Apache-2.0) we depend on; standard for Rust ecosystem.
Consequences: LICENSE + NOTICE at repo root; Cargo `license = "Apache-2.0"`; package.json
`"license": "Apache-2.0"`. Applies from first commit (the prior-art bridge's license gap is the cautionary tale).

#### ADR 004: Repo name — solid-gpui (decided 2026-08-24)
Decision: `solid-gpui` for repo, packages `@solid-gpui/*`, helper binary `solid-gpui-helper`.
Why: says exactly what it is; distinct from `the prior-art bridge` (avoids clone perception); npm scope free to take.
Consequences: local dir rename pending (user runs `mv` outside a live session); check npm scope
availability before first publish.

#### ADR 005: Helper binary distribution — per-platform npm packages (decided 2026-08-25)

**Decision.** Ship the helper binary inside per-platform npm packages
(`@solid-gpui/helper-darwin-arm64`, `-darwin-x64`, …) declared as
`optionalDependencies` of `@solid-gpui/client` (the esbuild/swc model). The
client resolves the binary via `require.resolve` at spawn time. No runtime
downloads, no postinstall scripts. Publish order is a hard invariant:
platform packages first, then the packages that pin them.

**Alternatives rejected.**
- *Runtime download from GitHub Releases (checksummed, cached)* — first
  design this session. Rejected: runtime network dependency (corporate
  proxies/firewalls), download+gunzip+chmod+cache machinery in the zero-dep
  client, and no precedent among major binary distributors.
- *cargo build on install / postinstall* — pnpm and Bun block lifecycle
  scripts by default; multi-minute Rust+Zed dependency builds for end users.

**Precedent.** The per-platform optionalDependencies model is standard
industry practice (esbuild, swc, biome, lightningcss): binaries ship inside
npm packages selected by os/cpu fields, no network at runtime, offline
installs work, and lockfiles pin exact binary versions. Publish order
(platform packages before the packages that pin them) is the esbuild
invariant, re-derived here from npm's install-time resolution.

**Constraints.** macOS-only for 0.1.0 (helper GUI paths need Metal; Linux
gpui build is untested here — defer). TS packages publish as built dist
(source-only `exports` pointing at `.ts` is Bun-only). The npm scope
`@solid-gpui/*` is unclaimed (checked 2026-08-25).

**Consequence.** Dev flows keep using `target/debug` via the existing
resolution order (env override → dev target → platform package), so the
monorepo needs no installed platform packages of its own.

### 2026-08-26 - S14 headless controls
status: done

#### ADR 006: Select/combobox contract boundary

**Decision.** Close S14 with the tooltip slice shipped and select/combobox explicitly
deferred to a future implementation slice. That future slice targets a headless
primitives namespace (`Root`/`Trigger`/`Content`/`Item`), starts with one controlled
string value, renders content in-window through anchored/deferred elements, and
requires typed role/expanded/selected semantics. Multi-select, uncontrolled state,
native `PopupOptions`, and an untyped styling-only accessibility model are outside
that slice.

**Why.** The pinned gpui exposes low-level `PopupOptions`, but the project has no
select/combobox primitive, popup lifecycle protocol, or accessibility-role contract.
The existing input, focus, key-binding, list, and anchored/deferred seams are enough
to define a safe target without inventing a native widget or a new command channel.
Explicit deferral prevents an incomplete control from being mistaken for a supported
public API.

**Consequence.** S14 introduces no select/combobox production code or protocol
changes. A future S14b implementation must reopen from this contract, add RED tests
first, and verify the API/wire behavior independently before changing the S14 status.

### 2026-08-26 - S14b implementation
status: done

#### ADR 007: Typed accessibility bridge for headless controls

**Decision.** Add one atomic `setAccessibility` mutation carrying a closed role set
(`combobox`, `listbox`, `option`) and optional `value`, `expanded`, and `selected`
fields. The helper maps it to GPUI's AccessKit fields on stateful div/input paths;
select/combobox state remains in Solid and uses the existing event and overlay
seams.

**Why.** GPUI's pinned `StatefulInteractiveElement` already exposes the required
AccessKit role and live-property methods, while the retained tree and renderer had
no safe way to express them. One validated object keeps TS/Rust in lockstep without
inventing a native popup lifecycle or leaking implementation-specific calls onto the
wire.

**Consequence.** The S14b public primitives are JSX-runtime components with a
controlled string value. Item identity/disabled state is static for this slice;
outside-click dismissal and IME-composition arrow suppression remain deferred.

### 2026-09-02 - Release hardening: private npm + workflow eval fix

#### ADR 008: npm packages publish private (restricted)

**Decision.** Every `@solid-gpui/*` package — the three TS packages and all
helper platform packages — publishes with `--access restricted` for 0.1.0.

**Why.** Prerelease API on a niche stack: private keeps the discovery
surface minimal while the first real consumer (invite-based) drives
requirements. Un-publishing or restricting after a public release is
messier than the reverse flip, which is one registry setting plus one flag
in release.yml.

**Consequence.** Installs need scope access (registry invite or granular
token); the publishing npm account needs a paid plan. README quickstart and
docs/packaging.md state this so a stranger's E403 is self-explaining. The
same commit that fixes release.yml also moves the NPM_TOKEN gate out of
step-level `if` (secrets context is unreadable there — the workflow failed
to parse on every push, so even a tagged run would have died at 0 s).
