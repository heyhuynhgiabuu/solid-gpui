# solid-gpui roadmap

This roadmap is for maintainers and early adopters evaluating solid-gpui as the
UI foundation for a native SaaS client. It prioritizes the risks that can make
an otherwise working demo unusable in a real application: consumer TypeScript
DX, styling, overlays, runtime support, distribution, and platform evidence.
It is a sequence of release gates, not a promise that every capability will
ship.

Every change must preserve the protocol, retained-tree, lifecycle, and
poison-on-failure invariants in `AGENTS.md` and
`.pi/artifacts/DECISIONS.md`.

## North-star contract

The target is a native desktop UI authored in Solid JSX and TypeScript, with a
choice of Bun or Node as the JavaScript host and a Rust/GPUI helper for native
rendering. The default architecture remains out-of-process:

```text
Solid JSX + signals → NDJSON mutation batches → Rust helper → GPUI window
             Node.js or Bun.js host                 native event loop
```

The project should make the following distinction explicit:

- **Supported today:** a macOS-first, prerelease native UI with Solid
  `2.0.0-rc.3`, a separate helper process, renderer-owned JSX/TypeScript
  declarations, typed GPUI style maps, and basic in-window select/combobox
  overlays.
- **Supported direction:** the same client transport from Node.js or Bun.js,
  with the same renderer contract and browser-conditioned Solid runtime.
- **Not supported today:** full Tailwind/CSS compatibility, a single-file native
  executable, or packaged Linux and Windows GUI support.

A prospective application that requires the last line is **no-go until the
corresponding gates below pass**. A macOS-first application that accepts a
sidecar helper and custom style maps can run an early vertical spike now.

## Current verified baseline

| Area | Current truth | Release stance |
| --- | --- | --- |
| Rendering | Real GPUI native rendering, no webview; Rust owns the native event loop | Credible prototype; prerelease |
| Process model | One JavaScript client process talks to one Rust helper process over NDJSON | Keep as the current default; do not replace it merely to simplify packaging. ADR 002 leaves room for a future in-process N-API backend behind the same protocol seam if the upstream runloop support lands |
| JavaScript host | Client uses Node-compatible `node:` APIs; real Bun and Node smoke paths exist | Formalize both Node and Bun support with consumer fixtures |
| Solid | `solid-js`, `@solidjs/universal`, `@solidjs/web`, and compiler pinned to `2.0.0-rc.3` | Solid 2 only; every entry point needs `--conditions=browser` |
| JSX | Universal Babel plugin and `mountJsx()` work; renderer-owned types pass an external `.tsx` fixture and Bun/Node real-helper smoke; `h()` remains the lower-level API | Keep the Solid compiler/runtime versions aligned and retain the universal Babel transform |
| Styling | Typed camelCase `StyleMap` with a GPUI subset; unknown props are ignored | Do not claim Tailwind support |
| Overlays | Controlled single-select/combobox uses in-window `anchored` + `deferred` content | Basic dropdown fit; generic popover semantics incomplete |
| Application menus | P9 application menu bar with submenus, separators, shortcuts, and macOS native actions | Separate macOS app-chrome feature, not a dropdown replacement |
| Windows | One helper opens one GPUI window; multiple connections can mean multiple helpers | No first-class multi-window manager |
| Distribution | Platform npm helper packages and release automation cover macOS arm64/x64 | Linux/Windows GUI packages require hosted runtime evidence |
| Standalone executable | Bun can compile the JavaScript side, but helper resolution expects a real external executable | Sidecar is the baseline; single-file packaging is a separate experiment |

The exact evidence behind these rows is kept in `README.md`, the release
workflow, the benchmark scripts, and the completed audit in
`.pi/artifacts/TODO.md`.

## Product-fit gates

These gates are ordered by the cost of discovering failure late. The sequence
is risk/dependency order, not a strict priority sort: a later P0 gate may
preempt an earlier P1 gate when release needs require it. Do not spend time on
renderer polish while a gate marked **no-go** is still open.

### Gate 0 — Consumer acceptance fixture (next)

Create one small representative SaaS screen outside the renderer unit tests:
form input, signal-driven text, an interactive action, a select/combobox, and a
styled layout. For this gate, author it with the currently supported `h()`/`.ts`
surface; reserve the external `.tsx` and public JSX typecheck for Gate 1. Run it
through both JavaScript hosts and the real helper.

Record these decisions before implementation expands:

- supported Node and Bun versions;
- target operating systems and CPU architectures;
- whether a helper sidecar is acceptable;
- whether Tailwind means exact Tailwind semantics or a familiar utility-class
  authoring surface;
- whether one window is sufficient for the first release.

**Exit criteria**

- The fixture is runnable through the currently supported `h()`/`.ts` surface
  and executes from Bun and Node with the browser condition.
- The same user action produces the expected event and mutation at the real
  helper boundary.
- Every unsupported requirement is written down rather than silently degraded.

### Gate 1 — First-class JSX and TypeScript DX (P0)

The user should not have to choose `h()` merely because the package's types or
build recipe are incomplete.

Work:

- expose renderer-owned `jsx-runtime` and `jsx-dev-runtime` type entries;
- define `JSX.Element`, `JSX.IntrinsicElements`, children, events, style,
  input, and custom element props for the supported renderer surface;
- support the normal `jsxImportSource` TypeScript configuration while retaining
  the universal Babel transform needed by Solid;
- provide one tested Babel/Vite-style recipe and one tested Bun development
  recipe, plus the equivalent Node execution recipe;
- let `mountJsx()` accept the same connection/helper configuration as the
  lower-level mount path so packaging does not force a hidden global override;
- make the JSX example the primary README path and keep `h()` as an explicit
  trusted/dynamic escape hatch.

**Exit criteria**

- An external `.tsx` fixture passes `tsc --noEmit` with no implicit-`any` JSX
  errors and resolves `@solid-gpui/solid/jsx-runtime`.
- The fixture compiles and runs under both Bun and Node with
  `--conditions=browser`.
- A click, input edit, and signal update cross the real helper boundary.
- A compiler upgrade fails the compile-surface test before it reaches users.

### Gate 2 — Styling decision and utility-class DX (P0 if required)

Full browser Tailwind is not automatically transferable to GPUI. CSS layout,
cascade, pseudo-elements, media queries, arbitrary values, and browser
semantics do not exist just because a class string is accepted.

Choose one of these deliberately:

1. **Recommended:** a documented Tailwind-compatible subset compiler. It
   converts approved utility classes and variants into the typed `StyleMap` and
   explicit state layers. Unsupported utilities fail at build time or produce
   an actionable diagnostic.
2. **Smaller scope:** a typed GPUI utility/token library with Tailwind-like
   naming, explicitly marketed as a different styling system.
3. **No-go:** promise full Tailwind semantics without implementing and testing
   the missing CSS behavior.

Do not add a `className` prop that is silently ignored. If utility classes are
not implemented, the renderer should reject or warn clearly and the README
must say so.

**Exit criteria**

- The decision and supported utility matrix are documented.
- A representative fixture covers layout, colors, spacing, hover/active,
  responsive behavior if claimed, and arbitrary-value policy.
- TypeScript catches unsupported style authoring where possible.
- Real GPUI output and mutation behavior are tested; no browser-CSS equivalence
  is claimed without evidence.

### Gate 3 — Native overlays and application UX (P1)

Keep the existing S14b controlled primitives as the minimum baseline, then
finish the semantics a SaaS client normally needs:

- pointer outside-click dismissal (headless-landed in Gate 3-a: protocol
  `outsideClick` event, helper detector, select wiring, TestApp proof; real
  GUI evidence still owed for full Gate 3 closure);
- focus transfer and restoration (headless-landed in Gate 3-b: select
  content autofocuses on open and the helper restores the pre-overlay
  focus target on dismissal — removal hook guards both ids at fire time;
  combobox deliberately keeps input focus);
- keyboard navigation and selection behavior;
- IME-composition-safe arrow handling;
- positioning, clipping, and window-edge behavior for generic popovers;
- clear separation between in-window popovers, native dialogs, and the macOS
  application menu bar.

Multi-window support is deliberately after the one-window path. If the
acceptance fixture requires it, add a first-class window/session manager rather
than treating multiple independent helper processes as one application.

**Exit criteria**

- A real GUI fixture opens, navigates, selects, dismisses, and destroys an
  overlay without stale focus/listener state.
- macOS menu behavior remains separately tested.
- GUI evidence is reported per OS; headless tests are not presented as visual
  proof.

### Gate 4 — Node/Bun runtime contract and packaging (P0 for distribution)

The JavaScript host and the native helper are separate deliverables.

#### Runtime contract

Support the same public APIs from:

- Bun at the pinned supported version;
- a declared Node LTS range using built package output;
- `--conditions=browser` for every Solid entry point in both hosts.

Keep the transport/runtime boundary free of Bun-only assumptions. Bun's preload
script is a convenience, not the Node build contract.

#### Distribution baseline

Use an application bundle containing:

```text
app launcher / Bun or Node runtime
└── platform-specific solid-gpui-helper sidecar
```

The existing npm model remains useful for library users: publish the helper
platform packages first, then the TypeScript packages that pin them. For an
application distribution, add a launcher or explicit helper-path API that:

- locates the sidecar relative to the installed application;
- preserves executable permissions;
- handles macOS signing/notarization and the equivalent Windows/Linux release
  requirements;
- never falls back to a development path in a production bundle;
- reports a useful error when the sidecar is missing.

#### Optional Bun single-file experiment

A compiled Bun executable may still be offered, but it is not the baseline. The
command must include the Solid condition and an explicit helper strategy:

```sh
bun build --compile --conditions=browser \
  --target=bun-darwin-arm64 ./app.ts --outfile myapp
```

A successful Bun compile is not sufficient. The experiment must prove one of:

- an adjacent helper is shipped and discovered; or
- the helper is embedded, extracted to a real executable path, permissioned,
  signed, and launched safely at runtime.

Build a separate Rust helper for every OS/CPU target; Bun's target flag does
not cross-compile GPUI. Do not call the result single-file until a clean-machine
launch, first render, input event, teardown, and update flow all pass.

**Exit criteria**

- Fresh-machine install/launch works without Rust, Bun, or Node development
  dependencies beyond the declared application runtime.
- Node and Bun execute the same consumer fixture.
- macOS arm64/x64 are packaged; Windows/Linux are added only after real GUI
  runtime evidence, not merely a successful compile.
- Signed artifacts, upgrade behavior, crash/exit cleanup, and helper version
  compatibility are tested.

### Gate 5 — Platform and operational readiness (P1)

Before calling the project a native-client foundation:

- run real-window tests on every advertised platform and architecture;
- keep protocol/helper headless tests as the cross-platform baseline;
- validate startup, window close, helper crash, poisoned-batch recovery, and
  clean teardown;
- define logging, crash diagnostics, version reporting, and update/rollback
  expectations for the application bundle;
- document OS permissions, filesystem/shell command trust, signing, and
  notarization responsibilities.

A platform gets a support badge only after hosted or local runtime evidence
exists for the actual GUI path. Build-only or headless-only evidence stays
labeled as such.

### Gate 6 — Measurement-led performance (P1)

The measurement foundation is already in place:

```sh
bun run benchmark:solid
cargo build -p solid-gpui-helper
bun run benchmark:stdio
bun run benchmark:gpui
bun run benchmark:lifecycle
bun run benchmark:compiler
```

Keep the boundaries separate:

- Solid graph and flush scheduling;
- renderer mutation creation;
- JSON encoding and decoding;
- real client/helper transport;
- retained-tree apply;
- GPUI render/layout/paint;
- lifecycle state and memory retention;
- compiled JSX versus runtime `h()`.

Use a representative consumer fixture from Gate 0 before optimizing. Prefer
stable identity, skipped redundant writes, list reconciliation, and measured
host-side layout work over speculative wire compaction. Report p50/p95/p99,
sample size, versions, OS, and headless/GUI status. Do not add CI performance
thresholds until the scenario is stable across supported runners.

A candidate optimization is accepted only when it improves the named metric
without increasing mutation errors, duplicate removals, stale events, poisoned
batches, lifecycle retention, or frame instability.

### Gate 7 — Wire format (P12, optional and last)

Keep the object JSON wire format as the compatibility baseline. Reopen P12 only
when transport/encoding is demonstrated to be material in the end-to-end
measurement.

Before implementation, write and review a direct encoder design covering:

- protocol versioning and capability negotiation;
- object-format fallback and mixed-version behavior;
- decode/apply error reporting and sequence correlation;
- UTF-8 correctness and fixture generation for both TypeScript and Rust;
- poison-on-failure semantics and recovery/remount behavior;
- a fair comparison at the same workload and boundary.

If the direct encoder does not win end-to-end, delete the experiment and keep
the object format.

## Solid compatibility policy

| Runtime | Status | Rule |
| --- | --- | --- |
| Solid 2.0.0-rc.3 | Supported | Keep runtime, universal, web, compiler, JSX types, and browser-conditioned entry points aligned. |
| Solid 1.9.x | Isolated experiment only | Use `compat/solid1`; never add runtime feature detection or Solid 1 imports to the Solid 2 package. A production adapter needs its own package and release track. |

The Solid 1 spike proved technical feasibility for a small contract but did
not establish package support. Revisit it only after the Solid 2 consumer path
and distribution gates are stable.

## Already delivered

- Protocol v1 with shared TypeScript/Rust fixtures, validation-before-rendering,
  sequence correlation, and poison-on-failure behavior.
- Out-of-process GPUI helper with stdio transport, native input/IME state,
  dialogs, shell commands, menus, media, markdown, canvas, lists, tooltips,
  and typed accessibility.
- Solid 2 renderer lifecycle cleanup, keyed reconciliation, event backchannel,
  S14b controlled select/combobox, and a working universal JSX runtime.
- Hosted Linux/Windows headless validation plus local macOS window evidence;
  GUI claims remain environment-dependent.
- Solid, stdio, GPUI, lifecycle, and compiler benchmark baselines, including
  the observation that the current compiled-JSX fixture emits more mutations
  than runtime `h()` and therefore needs measurement rather than assumption.
- A pinned, non-published Solid 1 compatibility probe at
  [`compat/solid1`](./compat/solid1), documented as unsupported by the root
  package.

## Explicit non-goals and stop conditions

- Do not turn the helper into an in-process addon to simplify packaging.
- Do not silently accept `className` or advertise Tailwind without a defined
  compiler/semantic subset.
- Do not claim standard TypeScript JSX support until an external `.tsx` fixture
  typechecks against the published package.
- Do not claim one-file native distribution until the helper launch path is
  proven from a clean packaged artifact.
- Do not claim Linux/Windows GUI support from build or headless tests alone.
- Do not add Solid 1 branching to the Solid 2 package.
- Do not weaken lifecycle, retained-tree, protocol, or poison invariants for a
  benchmark or convenience API.
- Stop a slice when its measurement is noisy, its benefit is below error, its
  compatibility contract is unresolved, or it requires speculative complexity.
  Record the result and keep the simpler path.

## Research sources

- [Solid 2.0 RC releases](https://github.com/solidjs/solid/releases)
- [Solid 2 migration and JSX ownership](https://github.com/solidjs/solid/blob/refs/heads/next/documentation/solid-2.0/MIGRATION.md)
- [Solid universal renderer documentation](https://github.com/solidjs/solid/tree/next/packages/solid/universal)
- [Solid fine-grained reactivity](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity)
- [Bun standalone executables](https://bun.sh/docs/bundler/executables)

Versioned local evidence: Solid/universal/compiler `2.0.0-rc.3`, Solid 1
`1.9.15`, and Bun `1.4.0` were checked on 2026-08-27. External GUI and
production-distribution claims remain open until the relevant gates produce
runtime artifacts and evidence.
