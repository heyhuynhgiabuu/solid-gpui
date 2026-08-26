# P4 review brief (r1) — window/dialog/shell commands

## Context

Repo: solid-gpui. P4 per roadmap: imperative desktop surface (window ops,
dialogs, shell) over the EXISTING command channel (getStats/captureFrame
precedent). Single commit under review:
- 17b0b31 feat(solid): window/dialog/shell commands (P4)
(artifact bookkeeping commits ride along — not code)

## What changed (verify against the diff)

1. Protocol lockstep: 7 Command variants (Rust enum lib.rs + closed-name
   matcher + updated error message; TS union + KNOWN list + per-type decode
   validation with WINDOW_ACTIONS/DIALOG_LEVELS closed sets). Payloads:
   setTitle{title}, windowAction{action}, dialogMessage{level, message,
   detail?, answers[]}, dialogOpenFile{files?,directories?,multiple?,
   prompt?}, dialogSaveFile{directory?, suggestedName?}, shell{Reveal,Open}
   Path{path}.
2. Helper dispatch (main.rs, window job loop + command_ident): window ops
   via window.update (set_window_title/minimize/zoom/toggle_fullscreen/
   activate; unknown-action arm is defense-in-depth no-op AFTER the protocol
   pre-check); dialogMessage via window.prompt + PromptButton::new map →
   {answer}; dialogOpenFile/SaveFile via AsyncApp::update →
   prompt_for_paths/prompt_for_new_path (IMPORTANT: AsyncApp::update returns
   R directly, not Result — arms match accordingly); shell via
   reveal_path/open_with_system. Dialogs await oneshot receivers — macOS
   panels are async so no main-thread block; batches queue behind an open
   dialog under strict reply ordering (documented in code comment + README).
3. TS API (packages/solid/src/desktop.ts): appWindow/dialog/shell module
   functions over a NARROW CommandChannel interface (interface segregation;
   HelperConnection satisfies it); seq counter from 1_000_000 (disjoint
   namespace). RenderHandle gains bound sugar (handle.window/dialog/shell,
   bindX helpers in render.ts; RenderHandle interface updated).
4. Tests: desktop.test.ts — 5 tests via fake channel (wire shapes, answer
   index, paths|null, seq range) + EVERY issued command round-trips through
   decodeCommand (lockstep shape pin). README section with example.

## Invariants to actively check

- A. Lockstep: closed command-name sets BOTH sides; unknown names get the
  right error variant (Rust unknown-command message updated? TS shape
  error at type); result payload shapes ({applied}, {answer}, {paths},
  {path}) — no Rust-side schema TS can't express.
- B. Seq discipline: module counter 1_000_000+ — check the client's
  disjoint-range contract comment still holds (renderer batches 1..,
  ad-hoc commands small); wrap behavior documented.
- C. Dialog blocking semantics: awaiting receivers in the job loop — verify
  no path can block the MAIN thread (macOS async panels confirmed in recon:
  gpui_macos platform.rs:777 ConcreteBlock + oneshot). Window.prompt: check
  gpui's prompt_builder re-entrancy panic path ("Re-entrant window
  prompting is not supported") — two concurrent dialogMessage commands
  (queued sequentially in the job loop, so re-entrancy can't happen from
  OUR side? reason it through).
- D. command_ident exhaustiveness + transport-mode (--stdio, no window):
  what do the new commands do there? (command_ident is shared — check
  run_stdio doesn't dispatch them as if a window existed.)
- E. TS API shape: CommandChannel narrowing doesn't break RenderHandle
  users; the bind-null trick for dialog.message preserves `this`-free
  purity; optional-field spread omits undefined fields (wire cleanliness).
- F. TDD: desktop tests fail without desktop.ts (compile RED acceptable);
  decodeCommand round-trip test genuinely pins lockstep.

## Evidence you can run

- bun run test (136 expected), bun run typecheck
- cargo test -p solid-gpui-protocol -p solid-gpui-helper (31 + 79 + 15 GUI)
- cargo clippy --all-targets, cargo fmt --all -- --check
- GUI manual (optional, macOS): setTitle via a script — window title
  changes live.

## Verdict format

CLEAN, or Blocker/Major/Minor with path:line evidence. Focus: C (thread/
re-entrancy reasoning), D (transport mode), A (lockstep).
