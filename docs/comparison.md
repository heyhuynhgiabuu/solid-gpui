# Positioning and comparison

Why this project exists next to the stacks a Solid/TypeScript developer would
consider first, and — since the closest sibling is MIT — what each
implementation actually offers today. Facts here are checked against each
project's README/docs as of 2026-08-29.

## The niche in one sentence

**Author a desktop UI in Solid JSX + TypeScript; render it natively with Zed's
GPUI through a versioned, out-of-process wire protocol.**

## Against the wider ecosystem

| Stack | Model | Difference from solid-gpui |
| --- | --- | --- |
| **Tauri 2** | Native shell + **web UI** (system webview: WKWebView/WebView2/WebKitGTK) | Tauri keeps the entire web platform (DOM/CSS/browser); we remove the browser and its inconsistencies, keeping TS authoring. Different trade on the same "TS app + Rust layer" shape. |
| **Electron** | Bundled Chromium + Node | Same web-vs-native axis as Tauri, heavier. |
| **Floem** | All-Rust reactive UI (own engine, Leptos-lineage signals, Taffy) | No TypeScript authoring. Validates that fine-grained-signal retained trees are the right core model. |
| **gpui-component / gpui-shell** (longbridge) | Rust components on GPUI; `gpui-shell` embeds a JS engine for plugin-style scripting | Nearest overlap: "JS writes, GPUI paints". But the script runs **in-process** with an embedded engine; ours is a separate real Node/Bun process with a protocol contract, Solid reactivity, and the full npm toolchain. |

## Against lxsmnsyc/solid-gpui (the closest sibling, MIT)

Both projects are built on the same thesis and the same architecture shape:
Solid reconciles in JavaScript, a Rust host owns the GPUI window and the
retained tree, and the two talk newline-delimited JSON over stdio. Neither
diffs host-side; both ship a host binary fetched from the Zed repository.
Shared physical constraints follow from the process split (canvas cannot be
read back or measured; one window per process; macOS-shaped menu bars).

### Where they are ahead

- **Drag & drop** support.
- **Deeper window options** at open: `titlebar: false`, `appearance:
  "blurred"`, explicit x/y, `onClose`.
- **`Dynamic` shipped earlier** (our `Dynamic` is ported from theirs, MIT,
  attribution in `packages/solid/src/jsx.ts`).
- **A Vite plugin and an Oxc-based compiler export** for bundler-native setups
  (ours documents a Bun preload + Babel recipe).
- **Extended control flow** (`Repeat`/`Reveal`/`Loading`/`Errored` beyond
  Solid's `For`/`Show`/`Switch`).

### Where solid-gpui (this repo) is ahead

- **Controlled select/combobox overlays** with outside-click dismissal, focus
  transfer/restoration, IME-safe key handling, and flip-to-fit popover
  anchoring — a component layer they do not document.
- **A failure contract**: a failed batch poisons the renderer (no silent
  double-apply on retry), with a tested `resetTree` + remount recovery and
  `getStats` version pairing (`protocolVersion` + `helperVersion`) so
  launchers can verify the helper before first use.
- **Cross-language fixtures**: JSON fixtures parsed by BOTH the TypeScript and
  Rust suites, so the wire contract cannot drift between implementations.
- **`setTheme`** semantic tokens (surface/foreground, forward-compatible open
  set) and a readable default theme for unstyled windows.
- **A documented Tailwind-compatible class subset** with build-time refusal of
  anything outside the matrix.
- **A pull-model list caveat they document and we avoid**: their virtualised
  list requests rows over the wire and shows blank rows for one frame; our
  retained-items model keeps every item helper-side and paints the visible
  subset without a round trip.
- **Benchmarks with a policy** (dated baseline, p50/p95/p99, sample sizes) and
  a measured, rejected wire-compaction experiment on record.

### How to choose

- You need drag & drop or heavy window chrome today → use theirs (and say
  thanks; it is good, permissively licensed work).
- You need a real form-control layer, a strict failure/versioning contract for
  an app that must ship, or Tailwind-flavoured authoring → use this repo.
- Either way, the protocol seam (not the implementation) is the long-term
  asset: two independent implementations of one niche is how the niche proves
  demand.
