# Solid 1 compatibility spike

This directory is an isolated, non-published Solid 1 experiment. It is not a
second entry point for `@solid-gpui/solid` and is not part of the root Bun
workspace.

Install its exact dependency lockfile, then run the probe from the repository
root:

```sh
npm ci --prefix compat/solid1 --ignore-scripts --no-audit --no-fund
bun --conditions=browser compat/solid1/probe.mjs
```

The probe uses `solid-js@1.9.15`, `solid-js/universal` from that package,
and `babel-preset-solid@1.9.15`. It runs lifecycle/disposal, keyed reorder,
Solid 1 effect/batch, compiled input/event, and actual
`@solid-gpui/client` → helper `--stdio` acknowledgement checks. The adapter
inside the probe is deliberately minimal and records only the protocol
operations needed by those scenarios; it is not a production renderer.

## Result

The isolated boundary is technically feasible, but Solid 1 is **not supported**
by `@solid-gpui/solid`. Its compiler emits the Solid 1 universal contract:
`effect(callback, previousValueInitializer)`, while the supported Solid 2
compiler/runtime uses a split compute/commit effect contract. Solid 1 also
uses `solid-js/universal` inside `solid-js`, rather than the separate
`@solidjs/universal` package used by this repository.

Supporting both versions would therefore require a separately named package
with separately pinned runtime, compiler, JSX runtime, scheduling, and
lifecycle code. This spike does not make that support promise; the root package
remains Solid 2 rc.3-only.
