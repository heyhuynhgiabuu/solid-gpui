# P2 review brief (r1) — input maturity

## Context

Repo: solid-gpui. P2 per roadmap: make inputs behave like real text fields.
Recon (P2-a) found the input core already mature: host-side InputState
(value/caret/marked in UTF-16), full InputHandler impl for
text_for_range/replace_text_in_range/replace_and_mark (IME composing)/
unmark, Enter semantics, autosize, emoji unit tests. Three real gaps were
identified and closed in ONE commit under review:
- f4e174c feat(helper): input maturity — selection, paste, onInput/onChange split (P2 G1-G3)

## What changed (verify against the diff)

1. Protocol (lockstep): new closed-set EventType variant `input` — Rust
   enum (lib.rs) + TS union/EVENT_TYPES (mutation.ts). Renderer EVENT_NAMES
   now maps onInput→"input", onChange stays "change" (comment updated).
2. Helper G1: edit paths (edit_input + replace_and_mark) emit
   EventType::Input per edit and set `dirty`; `change` commits via
   HostView::commit_input_if_dirty on focus-out and Enter-submit paths;
   set_input_value (setValue) clears dirty. emit_event now routes through
   the injectable `self.sink` (was: direct write_event_line; production
   default sink IS write_event_line — behavior identical, testability up).
3. Helper G2: InputState.anchor (None = collapsed); selection() sorted
   range; selection_reversed(); set_selection(clamped);
   set_selected_text_range trait impl routes platform caret moves;
   replace_text_in_range None-range now replaces the ACTIVE selection.
4. Helper G3: InputHandler::paste(ClipboardItem) routes item.text()
   through edit_input.
5. Tests: input_selection_tests (collapse/direction/clamp/emoji-selection
   edit), input_commit_tests (observed sink: per-edit input events, ONE
   change on commit, setValue-cleared dirty does not commit, unknown id
   noop), GUI stdio_window input test updated to eventType input, TS
   onInput/onChange registration test, decodeEvent accepts input.

## Invariants to actively check

- A. Closed-set lockstep: "input" added BOTH sides in the same commit;
  unknown eventType still decodes as invalidShape on both; fixtures
  unaffected (event fixtures use click/keydown).
- B. Back-compat wire: existing consumers binding onChange on inputs now
  receive commit-on-blur instead of per-keystroke — that is a BREAKING
  semantic change for pre-P2 consumers (documented in commit). Check the
  demo/docs/examples: examples/counter.ts binds onInput? Search TS examples
  and README for onChange usage that assumed per-edit.
- C. dirty lifecycle: every edit path sets dirty (edit_input,
  replace_and_mark, paste, simulateInput, insert_text?); every commit path
  clears it exactly once; setValue clears it. Look for edit paths NOT
  setting dirty (insert_text for textarea Enter? it routes through
  edit_input — verify).
- D. Sink unification: emit_event via self.sink — check no path depended
  on emit_event bypassing the sink (e.g. tests capturing stdout).
- E. Selection semantics: set_selection clamping interacts correctly with
  subsequent edit_utf16 clamping (double-clamp safe); anchor cleared on
  edits (collapse), kept across movement.
- F. TDD validity: commit test asserts through the sink (would fail
  without the sink change + commit logic); selection tests fail without
  anchor support (compile-level RED for new API — acceptable per repo
  convention).

## Evidence you can run

- bun run test (128 expected; perf test is a known GUI flake — rerun in
  isolation before counting), bun run typecheck
- cargo test -p solid-gpui-protocol -p solid-gpui-helper (29 + 73 + GUI 14)
- cargo clippy --all-targets; cargo fmt --all -- --check
- GUI manual (optional): bun run example/counter has an input — typing,
  shift-arrow select, backspace over selection, Cmd+V, blur should commit.

## Verdict format

CLEAN, or Blocker/Major/Minor with path:line evidence. Focus: dirty-state
completeness (C), back-compat blast radius (B), lockstep (A).
