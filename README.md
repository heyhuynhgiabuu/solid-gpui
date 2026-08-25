# solid-gpui

Solid 2 components rendered by **Zed's GPUI** — native GPU-accelerated desktop
windows (Metal/Vulkan/DirectX), no webview.

```
Solid reactivity → mutation protocol (NDJSON) → Rust helper → GPUI
```

Status: **walking skeleton** (Phase 1). Mounts Solid trees into a native window
and applies fine-grained updates. Not yet production-ready.

## The one trap you must know

`solid-js@2.0.0-rc.x` resolves to **SSR stubs without reactivity** under the
default `node` condition (upstream [solidjs/solid#2569]). Effects run once at
mount and then silently never again. Always pass the browser condition:

```sh
bun --conditions=browser test
bun --conditions=browser run examples/counter.ts
# Node: node --conditions=browser ... (or NODE_OPTIONS=--conditions=browser)
```

[solidjs/solid#2569]: https://github.com/solidjs/solid/issues/2569

## Install (npm, no Rust toolchain)

The helper binary ships in per-platform npm packages selected automatically
by your platform (the esbuild model):

```sh
bun add @solid-gpui/solid solid-js   # or: npm i @solid-gpui/solid solid-js
```

```tsx
import { render } from "@solid-gpui/solid"
await render((h) => h("div", { style: { padding: 24 } }, "hello gpui"))
```

Run every entry point with `--conditions=browser` (Node and Bun alike —
under the default `node` condition solid-js resolves to non-reactive SSR
stubs and the UI freezes silently; see the trap below). macOS 13+ on Apple
silicon or Intel — the prebuilt helpers cover `darwin-arm64` and
`darwin-x64`. Other platforms: build the helper from
source (`cargo build -p solid-gpui-helper`) and point `SOLID_GPUI_HELPER`
at it.

Binary resolution order (first hit wins): the `SOLID_GPUI_HELPER` env var →
a monorepo `target/debug` build → the platform npm package. If none
resolves you get an error listing exactly what was tried and how to fix it.

For JSX authoring, configure your bundler with
`babel-preset-solid` (`{ generate: "universal", moduleName: "@solid-gpui/solid/jsx" }`);
see `scripts/solid-jsx-preload.ts` for a zero-config Bun dev setup.

## Quick start (from a checkout)

Prerequisites: Bun ≥1.4, Rust stable, full Xcode with the Metal toolchain
(`xcrun metal --version` must work).

```sh
git clone https://github.com/heyhuynhgiabuu/solid-gpui && cd solid-gpui
bun install
cargo build -p solid-gpui-helper          # first build compiles gpui shaders
bun run example/counter                  # counter in a real GPUI window;
                                         # with --hot, edits remount in-place
bun test                                  # runs with --conditions=browser
cargo test                                # protocol + helper suites
```

## Architecture

| Package | What it is |
| --- | --- |
| `@solid-gpui/protocol` | Mutation wire types (TS) + `solid-gpui-protocol` crate (Rust). Shared JSON fixtures are the cross-language contract. |
| `@solid-gpui/client` | Spawns/supervises the helper; NDJSON over stdio; per-seq correlation. |
| `@solid-gpui/solid` | `@solidjs/universal` renderer → mutations; hyperscript `h()` authoring. |
| `solid-gpui-helper` | Rust binary owning the main thread: GPUI window + retained tree. |

Out-of-process on purpose: the helper owns its main thread and native event
loop on every OS, so no Zed fork and no ThreadsafeFunction usage. See
`.pi/artifacts/DECISIONS.md`.

## Current limitations (v0.1)

- Authoring via `makeH(renderer)` hyperscript. JSX needs Solid's own compiler
  (`babel-preset-solid`, `generate: "universal"`) — a Vite/bun plugin is future
  work. Do NOT point react-style automatic JSX at this package.
- Event handlers register but clicks don't fire back yet (event backchannel is
  the next slice).
- macOS validated; Windows/Linux pending (the architecture needs no per-OS
  patches).
- Style subset only (box model, flex, colors as `#hex`, opacity); scrolling
  clips instead of scrolls for now.
- A failed batch poisons the renderer (by design): discard it and remount.

## License

Apache-2.0
