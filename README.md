# solid-gpui

Solid 2 components rendered by **Zed's GPUI** — native GPU-accelerated desktop
windows (Metal/Vulkan/DirectX), no webview.

```
Solid reactivity → mutation protocol (NDJSON) → Rust helper → GPUI
```

Status: **Phase 2 complete through P11; S14b select/combobox slice implemented**.
Mounts Solid 2 trees into native windows and applies fine-grained updates. P12
compaction was benchmarked but not adopted, and this is still a prerelease.
See [ROADMAP.md](./ROADMAP.md) for Solid 1 compatibility and optimization
plans.

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

## Solid version compatibility

`@solid-gpui/solid` currently targets Solid `2.0.0-rc.4` and the matching
`@solidjs/universal`, `@solidjs/web`, and compiler packages. Solid 1.x is not
supported by this package; its scheduling, ownership, and universal renderer
boundaries differ. The isolated, non-published compatibility probe in
[`compat/solid1`](./compat/solid1) passes its limited contract checks but does
not change that support status. See [ROADMAP.md](./ROADMAP.md) before attempting
a separate compatibility adapter.

## Install (npm, no Rust toolchain)

The helper binary ships in per-platform npm packages selected automatically
by your platform (the esbuild model):

```sh
bun add @solid-gpui/solid solid-js@2.0.0-rc.4   # or: npm i @solid-gpui/solid solid-js@2.0.0-rc.4
```

```tsx
import { mountJsx } from "@solid-gpui/solid/jsx"

function App() {
  return <div style={{ padding: 24 }}>hello gpui</div>
}

await mountJsx(() => <App />)
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

For JSX authoring, install the matching compiler plugin and Babel core:

```sh
bun add -d @solidjs/babel-plugin@2.0.0-rc.4 @babel/core
```

Configure your Babel pipeline with
`@solidjs/babel-plugin` (`{ generate: "universal", moduleName: "@solid-gpui/solid/jsx" }`)
as a plugin; see `scripts/solid-jsx-preload.ts` for a zero-config Bun dev setup.

For consumer TypeScript, point JSX type resolution at the renderer package:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@solid-gpui/solid"
  }
}
```

The Babel universal plugin remains the runtime transform; do not use the
React-style `jsx: "react-jsx"` transform for Solid reactivity. The renderer
owns both `jsx-runtime` and `jsx-dev-runtime` type entries. A compiled `.tsx` entry can mount through the shared path shown above. Use
`render((h) => ...)` when a low-level hyperscript or dynamic host-node escape
hatch is required.

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

The Gate 0 consumer acceptance fixture uses the supported `h()`/`.ts` surface
and runs against the real helper in both hosts:

```sh
bun run check:consumer-h
bun run smoke:consumer-h
SOLID_GPUI_GATE0_GUI=1 bun run smoke:consumer-h  # also exercises simulateInput events
```

The default smoke is transport-only so it is usable without a window server;
the GUI leg is the event-roundtrip check. It does not imply full Tailwind
semantics, multi-window application management, or a single-file executable.

## Tooltips (S14)

Use the `tooltip` prop on generic div-backed elements, inputs, textareas, and
lists. GPUI owns hover timing, placement, and window-edge flipping; the
content is a non-interactive string overlay and does not enter layout:

```tsx
h("div", { tooltip: "Save this item", style: { padding: 8 } }, "Save")
```

`null`, `undefined`, and an empty string clear the tooltip. Element-valued
content and custom delay are not supported yet. Text, markdown, canvas, SVG,
images, and scrollbar wrappers intentionally ignore the prop.

## Select and combobox primitives (S14b)

The `select` and `combobox` namespaces provide composable headless primitives
for the JSX universal runtime (`mountJsx`). `render((h) => ...)` remains the
low-level hyperscript surface. Both controls use a controlled string value; the
combobox trigger is an editable input.
Content is an in-window anchored/deferred overlay and GPUI receives typed
`combobox`, `listbox`, and `option` accessibility roles plus live expanded and
selected state:

```tsx
<select.Root value={color()} onValueChange={setColor}>
  <select.Trigger>{color()}</select.Trigger>
  <select.Content>
    <select.Item value="red">Red</select.Item>
    <select.Item value="blue">Blue</select.Item>
  </select.Content>
</select.Root>
```

`combobox.Root` uses the same `Content`/`Item` primitives with an editable
`combobox.Trigger`. Values are controlled; item `value`/`disabled` are static definitions (remount
an item when they change), filtering remains caller-owned. Presses outside the
root subtree dismiss the open menu (`onOutsideClick`, helper-side detection,
Gate 3-a). Focus semantics (Gate 3-b): opening a `select` transfers focus
into the listbox (`tabIndex` + helper-side `autoFocus`), keyboard navigation
runs there, blurring it or dismissing the menu by any path restores focus to
the element focused before the overlay opened; the combobox keeps focus in
its input while the menu is open. While an IME composition is active on an
input, the helper suppresses keyDown/keyUp and Enter-submit semantics (the
IME owns those keys; Gate 3-c) — Tab focus navigation and cmd-modified key
bindings stay live by design (the IME does not consume them). Multi-select,
uncontrolled state, and native popup windows are not part of S14b.
Try the real window demo with `bun run example/select`.

Real-GUI overlay evidence (Gate 3-d): `SOLID_GPUI_GATE3_GUI=1 bun run
smoke:gate3-gui` drives a real window through open → navigate → select →
dismiss → destroy using the `simulateKey`/`simulateMouse` commands (REAL
event dispatch, not synthetic edits). Without the env var it prints a skip
note — it needs a window server and a built helper. Post-restore synthetic
dispatch is verified (down/escape/enter land on the restored trigger); the
manual real-keyboard probe is `bun run probe:keyboard`.

## Popover anchoring (Gate 3-e)

Any element with the `anchor` prop plus `deferred` renders as an anchored
overlay: it escapes ancestor clipping, pins by the chosen corner/edge
center (`topLeft` … `rightCenter`), and fits against the window edge.
Window-edge fit defaults to **flip** (gpui's anchor-corner switch — the
web popover expectation); `anchorFit: "snap"` preserves the older
clamp-into-window behavior. `anchorOffsetX`/`anchorOffsetY` (px) add a
gap, e.g. a menu six pixels below its trigger:

```tsx
<select.Content style={{ anchorOffsetY: 6, anchorFit: "flip", width: 160 }}>
```

Visual verification of edge behavior on real windows is still owed (the
style-to-anchored mapping is unit-tested; hosted per-OS GUI evidence
remains a Gate 3 exit item).

## Trust boundary for JavaScript

The TypeScript renderer is a **trusted-code API**, not a sandbox. Component
functions, event handlers, reactive props, and desktop command arguments run
in the caller's JavaScript process; validate application data before passing it
to `render`, `mountJsx`, `h`, or command APIs. The protocol decoder validates
JSON shape, version, and supported operation/event/element names, but it does
not authorize filesystem or shell paths, or make arbitrary JavaScript safe.
The helper never evaluates JavaScript received over the wire.

## Window, dialogs, shell (P4)

The render handle exposes imperative desktop operations over the command
channel — each resolves when the OS answers:

```ts
const app = await render((h) => ...)
await app.window.setTitle("Untitled")
await app.window.toggleFullscreen()

const discard = await app.dialog.message({
  message: "Discard draft?",
  answers: ["Cancel", "Discard"],
  level: "warning",
})           // → button index

const files = await app.dialog.openFile({ multiple: true })  // string[] | null
const saveAs = await app.dialog.saveFile({ suggestedName: "notes.md" })

await app.shell.revealPath(saveAs ?? ".")     // Finder
await app.shell.openWithSystem(saveAs ?? ".") // default app
```

Standalone module forms (`appWindow`, `dialog`, `shell` from
`@solid-gpui/solid`) take any command-channel connection. Dialogs queue
batches behind them while open — the dialog is the user's current task.

## Architecture

| Package | What it is |
| --- | --- |
| `@solid-gpui/protocol` | Mutation wire types (TS) + `solid-gpui-protocol` crate (Rust). Shared JSON fixtures are the cross-language contract. |
| `@solid-gpui/client` | Spawns/supervises the helper; NDJSON over stdio; per-seq correlation. |
| `@solid-gpui/solid` | `@solidjs/universal` renderer → mutations; JSX universal runtime plus hyperscript `h()` authoring. |
| `solid-gpui-helper` | Rust binary owning the main thread: GPUI window + retained tree. |

Out-of-process on purpose: the helper owns its main thread and native event
loop on every OS, so no Zed fork and no ThreadsafeFunction usage. See
`.pi/artifacts/DECISIONS.md`.

## Current limitations (v0.1)

- Solid 2.0.0-rc.4 is still a prerelease; keep the runtime, universal renderer,
  and JSX compiler versions aligned. Node.js and Bun.js can host the client,
  but every Solid entry point needs `--conditions=browser`.
- JSX consumer types and `jsx-runtime`/`jsx-dev-runtime` entries now cover the
  supported GPUI surface and pass an external `.tsx` fixture. Runtime lowering
  still requires the universal Babel plugin with `jsx: "preserve"`; the
  React-style automatic JSX transform is not supported.
- Supported runtimes: Bun ≥ 1.4 and Node ≥ 20 (LTS 20/22/24) for the client,
  always with `--conditions=browser`; `engines` declares Node ≥ 20. For app
  distribution (sidecar helper, production resolution guard, signing), see
  [docs/packaging.md](./docs/packaging.md).
- Tailwind authoring is supported through a documented **compatible subset**:
  the `class` prop compiles approved utility classes (spacing scale, default
  palette, text sizes, layout, `hover:`/`active:` variants) into typed style
  maps, and refuses anything outside the matrix with a diagnostic. See
  [docs/tailwind-subset.md](./docs/tailwind-subset.md). `className` is not
  supported and warns; browser-CSS equivalence is not claimed.
- Platform evidence is split by test type: macOS has local full-suite/window
  evidence, while hosted CI validates Linux and Windows headless helper/
  protocol tests plus real stdio transport. GUI/window coverage remains
  environment-gated there, and prebuilt helper packages are currently macOS-only.
- `bun build --compile` packages the JavaScript/Bun side, not the Rust helper.
  A native application needs a separately shipped helper sidecar or an
  explicit extraction/signing layer; the current release path is platform npm
  helper packages.
- Protocol compaction (P12) is intentionally deferred: the numeric candidate
  cut wire bytes but regressed the measured encoder; revisit only with a direct
  encoder and explicit compatibility design.
- A failed batch poisons the renderer (by design): discard it and remount.

## License

Apache-2.0
