# solid-gpui roadmap

This roadmap is for maintainers and early adopters deciding whether
solid-gpui can be the UI foundation for a real native client. It states what
works, what is next in which order, and what the project will not do. It is a
sequence of release gates, not a promise that every capability will ship.

Every change must preserve the protocol, retained-tree, lifecycle, and
poison-on-failure invariants documented in [`AGENTS.md`](./AGENTS.md).

## North star

A native desktop UI authored in Solid JSX and TypeScript, hosted by Bun or
Node, rendered by a Rust/GPUI helper, out of process:

```text
Solid JSX + signals → NDJSON mutation batches → Rust helper → GPUI window
```

Where that stands:

- **Works today:** macOS-first prerelease. Solid `2.0.0-rc.4`, one helper per
  window, typed style maps with a documented Tailwind-compatible class subset,
  working select/combobox overlays with real focus/IME/anchoring semantics,
  dialogs, menus, markdown, lists, theming.
- **Direction:** the same client transport and renderer contract from Node.js
  or Bun.js, packaged as a real app bundle per platform.
- **Not yet:** full Tailwind/CSS semantics, a single-file native executable,
  packaged Linux/Windows GUI support, multi-window management.

An app that needs something from the last list is a **no-go until the matching
work below is done**. A macOS-first app that accepts a sidecar helper and the
supported style surface can build on this today.

## Done (verified, evidence-linked)

- **Protocol v1** — shared TypeScript/Rust fixtures, validation before
  rendering, sequence correlation, poison-on-failure. Object JSON is the wire
  format: a compaction experiment was measured and **not adopted** (fewer
  bytes, slower encode).
- **The helper** — GPUI window, retained tree, native input and IME state,
  dialogs, menus, shell commands, media, markdown, canvas, SVG, images,
  virtual lists, tooltips, accessibility roles, theming (`setTheme`), and
  `dumpTree` for debugging what the helper thinks is mounted.
- **The renderer** — Solid 2 lifecycle cleanup, keyed reconciliation, event
  backchannel, first-class JSX runtime types, controlled select/combobox with
  outside-click dismissal, focus transfer/restoration, IME-safe key handling,
  and window-edge popover anchoring (flip-to-fit default).
- **Benchmarks** — a representative consumer screen measured end-to-end
  against a real helper ([docs/performance.md](./docs/performance.md));
  seven boundaries baselined; no CI thresholds until scenarios are stable.
- **Verification** — hosted CI on Linux/Windows/macOS (headless helper and
  protocol suites, real stdio transport) plus local macOS real-window suites.
  Real-keyboard and IME behavior verified by a human-in-the-loop probe
  (`bun run probe:keyboard`).

## Next (in this order)

The order is risk/dependency order, not strict priority: distribution needs
may pull a later item earlier. Do not spend time on polish while a **no-go**
gap remains open.

### 1. Hosted per-OS GUI evidence

Hosted CI today runs headless tests on Linux and Windows; real-window
behavior is only proven locally on macOS. Add hosted jobs that drive the
existing window smokes (`smoke:gate3-gui`, `smoke:consumer-h`) on runners with
a window server (macOS runners have one; Linux needs Xvfb; Windows desktop
sessions look viable). A platform gets a support badge only after this —
headless green is never presented as GUI proof.

### 2. Linux and Windows packaging

Prebuilt helper packages exist for macOS (arm64/x64). Extend to Linux/Windows
only after item 1 produces runtime evidence there: build the helper per
target, publish platform packages, keep the version-pairing contract
(`getStats` → `protocolVersion` + `helperVersion` before first use).

### 3. Signing and notarization

macOS signing/notarization and the Windows equivalent, plus the
clean-machine launch test: install → launch → first render → input → close →
update, with no development tools installed. Needs real certificates (the
documentation in [docs/packaging.md](./docs/packaging.md) is written; the
execution is blocked on credentials).

### 4. The first real consumer

Every prior item exists so that an actual application can adopt this stack.
The honest priority: put it in front of one real project, and let its
requirements — not speculation — pick the next work items (multi-window?
more widgets? other platforms?).

### 5. Deferred by evidence, not by forgetting

- **Wire compaction** stays closed unless end-to-end measurement shows
  encoding is material; reopening requires a direct-encoder design review
  (versioning, fallback, error reporting, UTF-8, poison semantics) and a fair
  same-workload comparison. If it does not win, delete the experiment.
- **Solid 1 support** stays a pinned, unpublished experiment
  ([`compat/solid1`](./compat/solid1)). A production adapter would need its
  own package and release track — never Solid 1 branches inside this package.
- **gpui dependency**: gpui is now published on crates.io; migrating off the
  pinned Zed checkout is a real future path once the pinned APIs line up.
- **Multi-window**: deliberately after the one-window path; if a consumer
  needs it, add a first-class window/session manager rather than treating
  multiple helper processes as one application.

## Guardrails (do not do these)

- Do not turn the helper into an in-process addon to simplify packaging.
- Do not silently accept `className` or claim Tailwind without the compiled
  subset.
- Do not claim a platform's GUI support from build or headless tests alone.
- Do not claim single-file distribution until the helper launch path is
  proven from a clean packaged artifact.
- Do not weaken lifecycle, retained-tree, protocol, or poison invariants for
  a benchmark or a convenience API.
- Do not add CI performance thresholds before scenarios are stable across
  supported runners.
- Stop any slice when its measurement is noisy, its benefit is below error,
  or it needs speculative complexity — record the result, keep the simpler
  path.

## Version pins

- Solid `2.0.0-rc.4` (runtime, `@solidjs/universal`, `@solidjs/web`, Babel
  plugin, signals) — kept aligned in **both** `package.json` files; a split
  resolution installs two solid-js copies and silently kills reactivity.
- Bun `1.4.0` / Node LTS 20-24 for the client, always with
  `--conditions=browser`.

## Research sources

- [Solid 2.0 RC releases](https://github.com/solidjs/solid/releases) and the
  [Solid 2.0 migration notes](https://github.com/solidjs/solid/blob/refs/heads/next/documentation/solid-2.0/MIGRATION.md)
- [Solid universal renderer](https://github.com/solidjs/solid/tree/next/packages/solid/universal)
  and [fine-grained reactivity](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity)
- [Bun standalone executables](https://bun.sh/docs/bundler/executables)
