# Community probe — draft posts (r/solidjs + Solid Discord)

Status: DRAFT, casual tone. Post as-is or trim.
Repo: https://github.com/heyhuynhgiabuu/solid-gpui
Facts frozen as of 2026-08-25 (Phase 2 closed: S7–S12).

---

## 1) r/solidjs post

**Title:**
I made a Solid renderer for native desktop windows (no webview) — thoughts?

**Body:**

Hey 👋

So I've been building **solid-gpui** — it lets you render Solid 2 components
into real native desktop windows using Zed's GPUI (the editor's UI
framework, Metal on macOS). No webview, no Electron.

Repo: https://github.com/heyhuynhgiabuu/solid-gpui

The cool part: it's a real `@solidjs/universal` renderer. So Solid stays
Solid — your signals just work, updates are fine-grained, nothing weird.
Your JS runs a reactive graph that drives a native tree through a tiny JSON
pipe to a Rust helper.

A few choices I made (happy to argue about any of them):

- The Rust side runs as a **separate process**, talking NDJSON over stdio.
  No Zed fork, no node native modules, same code path on every OS. Simple.
- The wire protocol exists in TS and Rust, and both test suites parse the
  **same JSON fixtures** — so the two sides can't silently drift apart.
- Zero runtime deps in the protocol/client packages.
- Clean-room build, nothing copied from anywhere.

What actually works right now:

- Mount a tree, fine-grained updates (text/style/tree changes), ~1ms builds
- Click, mouse, focus, keyboard events (tabIndex, modifiers)
- Text input + textarea with **working IME** — marked text, caret survives
  emoji, Enter submits
- Virtualized list: 500 items, only ~60 painted. Has a `followTail` mode for
  chat UIs
- Animations: slap `transitionMs` on an element, style changes animate.
  Interpolated on the Rust side, retargets mid-flight without jumping

macOS works today. Windows/Linux should work without big changes (stock
upstream GPUI) but I haven't tried.

Honest gaps: you author with hyperscript `h()` for now (JSX plugin is next),
styles are a subset, one window.

One gotcha that cost me a day, saving you the same day:
[solidjs/solid#2569](https://github.com/solidjs/solid/issues/2569) — solid-js@2
resolves to SSR stubs under the default `node` condition, so your app just
silently stops being reactive. Run everything with `--conditions=browser`.

Questions for you:

1. Would you use this? What's missing?
2. Is `h()` a dealbreaker, or is the JSX plugin the thing to do first?
3. Multi-window, IPC, packaging — what do you need first for real desktop apps?
4. Anyone with GPUI experience on Windows/Linux want to help test?

---

## 2) Solid Discord (#showcase) — shorter

Hey! Sharing a project: **solid-gpui** — render Solid components into
**native GPU windows** with Zed's GPUI. No webview, no Electron.

It's a real `@solidjs/universal` renderer, so signals and fine-grained
updates just work. JS talks to an out-of-process Rust helper over a tiny
JSON pipe.

Working today: fine-grained updates, click/keyboard/focus events, text input
+ textarea **with real IME** (emoji don't break the caret), virtualized list
with a chat-style `followTail` mode, and animations (`transitionMs` on style
changes, handled on the Rust side).

```
git clone https://github.com/heyhuynhgiabuu/solid-gpui && cd solid-gpui
bun install && cargo build -p solid-gpui-helper
bun run example/counter   # counter with live input, in a real window
```

macOS for now, Windows/Linux shouldn't need big changes. Apache-2.0,
clean-room, zero runtime deps.

Main gap is hyperscript `h()` authoring — JSX plugin next. Curious what
people think, esp. if you want Solid for native desktop:
https://github.com/heyhuynhgiabuu/solid-gpui

(Gotcha: run with `--conditions=browser` or solid-js loads SSR stubs and
reactivity silently dies — solidjs/solid#2569.)

---

## 3) Optional short variant (X/Twitter)

Made a Solid renderer for native desktop windows: Solid signals → tiny JSON
pipe → Rust → Zed's GPUI. No webview, no Electron.

IME-ready text input, virtualized lists with chat follow-tail, Rust-side
animations. macOS today. Apache-2.0:
https://github.com/heyhuynhgiabuu/solid-gpui

---

## Posting notes (for you, not the posts)

- r/solidjs: check self-promo rules first; if there's a weekly showcase
  thread, use it. Flair "Project" if available.
- Discord: #showcase if it exists, else #general. The repo link is enough —
  don't paste the full draft twice.
- If anyone asks about the unrelated unlicensed bridge project: "clean-room,
  independent implementation, no code taken" and move on.
- After posting, drop the links here and we'll tick the TODO with any
  feedback worth tracking.
