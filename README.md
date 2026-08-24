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

## Quick start (macOS today)

Prerequisites: Bun ≥1.4, Rust stable, full Xcode with the Metal toolchain
(`xcrun metal --version` must work).

```sh
git clone <this repo> && cd solid-gpui
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
