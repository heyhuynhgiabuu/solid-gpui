# solid-gpui

Build native desktop apps with **Solid JSX + TypeScript**, rendered by Zed's
GPUI — real GPU-accelerated windows (Metal/Vulkan/DirectX), no webview.

```text
Solid JSX + signals → mutation protocol (NDJSON) → Rust helper → GPUI window
              (Node.js or Bun)         (stdio)        (native event loop)
```

**Status: working prerelease, macOS-first.** Real apps already run through
this stack end-to-end; Linux and Windows still need GUI-runtime evidence
before they are claimed. See [ROADMAP.md](./ROADMAP.md) for what is next.

## Quickstart

The helper binary ships in per-platform npm packages (the esbuild model; today
`darwin-arm64` and `darwin-x64`):

```sh
bun add @solid-gpui/solid solid-js@2.0.0-rc.5   # or: npm i …
bun add -d @solidjs/babel-plugin@2.0.0-rc.5 @babel/core
```

```tsx
import { mountJsx } from "@solid-gpui/solid/jsx"

function App() {
  return <div style={{ padding: 24 }}>hello gpui</div>
}

await mountJsx(() => <App />)
```

Wire up JSX types in `tsconfig.json`:

```json
{ "jsx": "preserve", "jsxImportSource": "@solid-gpui/solid" }
```

The Babel plugin needs `{ generate: "universal", moduleName: "@solid-gpui/solid/jsx" }`;
[`scripts/solid-jsx-preload.ts`](./scripts/solid-jsx-preload.ts) is a zero-config
Bun dev setup. The React-style `jsx: "react-jsx"` transform does **not** work
with Solid reactivity.

**Other platforms:** build the helper from source (`cargo build -p
solid-gpui-helper`) and point `SOLID_GPUI_HELPER` at it. Resolution order:
env var → monorepo `target/debug` build → platform npm package.

## The one trap you must know

`solid-js@2.0.0-rc.x` resolves to **SSR stubs without reactivity** under the
default `node` condition (upstream [solidjs/solid#2569]). Effects run once at
mount and then the UI silently freezes. Always pass the browser condition:

```sh
bun --conditions=browser run …
node --conditions=browser …   # or NODE_OPTIONS=--conditions=browser
```

[solidjs/solid#2569]: https://github.com/solidjs/solid/issues/2569

## Why this exists

Rust-native stacks (Floem, Iced, Slint) and in-process GPUI script hosts
(`gpui-shell`) both render with modern GPU toolkits. This project bets on a
different split: **the app lives in TypeScript, the pixels live in Rust, and a
versioned wire protocol keeps them honest.** That buys three things an
embedded engine does not:

- **Real process isolation.** A helper crash poisons the renderer client-side
  (detected, remountable); a dead app closes its helper cleanly — no embedded
  engine where one side's fault wedges both.
- **The Node/Bun ecosystem, unchanged.** Real bundler, tsc, test runners, npm.
- **Solid's fine-grained reactivity drives updates.** The renderer ships
  minimal mutation batches; UI state stays declarative, not imperative glue.

The cost is equally real: one extra process to launch and pair, and a protocol
boundary where primitives end.

## What works today

- **Real JSX + TypeScript** — renderer-owned `jsx-runtime` types; `h()` stays
  as a low-level escape hatch. Both Bun ≥ 1.4 and Node ≥ 20.
- **A GPUI style subset, typed.** camelCase style maps, `hover:`/`active:`
  state layers, transitions, tooltips, plus a documented Tailwind-compatible
  class subset ([docs/tailwind-subset.md](./docs/tailwind-subset.md)). Full
  browser CSS is **not** claimed; `className` warns.
- **Overlays that behave.** Controlled select + combobox with outside-click
  dismissal, focus transfer/restoration, IME-safe key handling, and window-edge
  anchoring (flip-to-fit by default):

  ```tsx
  <select.Root value={color()} onValueChange={setColor}>
    <select.Trigger>{color()}</select.Trigger>
    <select.Content style={{ anchorOffsetY: 6 }}>
      <select.Item value="red">Red</select.Item>
    </select.Content>
  </select.Root>
  ```

- **Real desktop plumbing** — native dialogs, app menus, window actions, shell
  open/reveal, clipboard-grade commands; each resolves when the OS answers:

  ```ts
  const app = await render((h) => …)
  const discard = await app.dialog.message({
    message: "Discard draft?",
    answers: ["Cancel", "Discard"],
  })
  await app.shell.revealPath(".")
  ```

- **Rich content** — markdown rendered entirely helper-side, virtual lists,
  canvas, SVG, images. Styled text runs for the `h()` surface.
- **Theming.** The helper paints a readable dark surface by default; `setTheme`
  overrides semantic tokens window-wide (unknown tokens are forward-compat
  ignored, bad colors fail atomically):

  ```ts
  import { theme } from "@solid-gpui/solid"
  await theme.set(connection, { surface: "#181825", foreground: "#cdd6f4" })
  ```

See it all in one window: `bun run example/gallery`.

## How it works

- The helper owns the main thread and native event loop on every OS (no Zed
  fork, no ThreadsafeFunction). One helper = one window today.
- The renderer diffs Solid's reactive graph into **mutation batches** applied
  to a retained tree helper-side; validation and rendering agree, so acks tell
  the truth.
- Input, focus, IME, and outside-click come back as **typed events** over the
  same stdio channel; every reply correlates by sequence number.
- **A failed batch poisons the renderer by design** (re-sending could
  double-apply). Discard and remount — `resetTree` is the sanctioned reset.

## Trust boundary

This is a **trusted-code API, not a sandbox**. Component functions, event
handlers, and command arguments run with your process's permissions; validate
application data before passing it in. The protocol decoder validates JSON
shape and known names, but it does not authorize filesystem or shell paths.
The helper never evaluates JavaScript received over the wire.

## Solid version compatibility

Targets Solid `2.0.0-rc.5` with the matching `@solidjs/universal`,
`@solidjs/web`, and compiler packages — kept aligned in **both** `package.json`
files (a split resolution installs two solid-js copies and silently kills
reactivity). Solid 1.x is unsupported; the pinned probe in
[`compat/solid1`](./compat/solid1) is an experiment, not a support claim.

## Architecture

| Package | What it is |
| --- | --- |
| `@solid-gpui/protocol` | Wire types (TS) + `solid-gpui-protocol` crate (Rust); shared JSON fixtures are the cross-language contract |
| `@solid-gpui/client` | Spawns/supervises the helper; NDJSON over stdio; per-seq correlation |
| `@solid-gpui/solid` | `@solidjs/universal` renderer; JSX runtime + hyperscript `h()`; desktop/theme/list helpers |
| `solid-gpui-helper` | Rust binary owning the GPUI window and the retained tree |

## Development (from a checkout)

Prerequisites: Bun ≥ 1.4, Rust stable, full Xcode with the Metal toolchain.

```sh
bun install
cargo build -p solid-gpui-helper   # first build compiles gpui shaders
bun run example/gallery            # the supported surface in one window
bun test                           # TS suites (browser condition encoded)
cargo test                         # protocol + helper suites
bun run typecheck                  # tsc ×3
cargo clippy --all-targets && cargo fmt --all -- --check
```

Window-smoke checks need a real display and a built helper; without one they
print a skip note (`SOLID_GPUI_GATE3_GUI=1 bun run smoke:gate3-gui`,
`SOLID_GPUI_GATE0_GUI=1 bun run smoke:consumer-h`). The manual
real-keyboard/IME probe is `bun run probe:keyboard`. For component work
without a Rust toolchain, point the helper env at the mock host — it speaks
the same protocol, validates through the same decoders, and prints the tree:

```sh
SOLID_GPUI_HELPER=$PWD/scripts/mock-host.mjs \
  SOLID_GPUI_MOCK_DUMP=1 bun --conditions=browser run app.ts
```

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/packaging.md](./docs/packaging.md) | App distribution, sidecar helper, version pairing, signing, diagnostics, update/rollback |
| [docs/performance.md](./docs/performance.md) | Dated benchmark baselines across all boundaries; measurement policy |
| [docs/tailwind-subset.md](./docs/tailwind-subset.md) | The exact class matrix `class` accepts |
| [docs/comparison.md](./docs/comparison.md) | Positioning vs Tauri/Floem/gpui-shell and the closest sibling project |
| [ROADMAP.md](./ROADMAP.md) | What is done, what is next, what will not happen |
| [AGENTS.md](./AGENTS.md) | Project invariants and contribution rules (humans and agents) |

## Current limitations

- Solid `2.0.0-rc.5` is itself a prerelease; keep runtime/universal/compiler
  versions aligned.
- macOS has the full local evidence; hosted CI covers Linux/Windows headless
  only. Prebuilt helpers are macOS-only so far.
- One window per helper; no multi-window manager yet.
- `bun build --compile` packages the JS side only — a native app still ships
  the helper sidecar (see [docs/packaging.md](./docs/packaging.md)).
- A wire-compaction experiment was measured and **not adopted** (smaller bytes,
  slower encode); object JSON stays the format.

## License

Apache-2.0
