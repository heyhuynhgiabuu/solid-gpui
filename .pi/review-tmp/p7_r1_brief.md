# P7 review brief (r1) — drag & drop between elements

## Context

Repo: solid-gpui. P7 v1 scope (recon): dragData source / onDragStart / onDrop
target / dragOverStyle layer; the drag preview is a self-made translucent
chip (24-char payload label). TOOLTIP deferred to its own slice (hover-timing
state + overlay machinery — separate concern). Single commit:
- f879288 feat(helper): drag & drop between elements (P7)

## What changed (verify against the diff)

1. Protocol lockstep: EventType DragStart/Drop (both closed sets);
   StyleState::DragOver (third state layer); Mutation::SetDragData {id,
   data: String} (JSON string; empty = clear; markdown rejects apply-side).
   Fixture batch-drag-01.json byte-identical Rust round-trip + TS parity
   test (decode + re-encode + shape asserts).
2. Helper (host.rs): DragPayload(pub String) — the ONE shared type so
   gpui's TypeId drop matching works across all sources/targets;
   DragPreview (Render entity, translucent chip, 24-char label). Wiring in
   apply_interactive: drag_data → el.on_drag(payload, constructor-that-
   emits-dragStart-and-builds-the-preview); drop listener → el.on_drop::
   <DragPayload>(emit drop with value=payload); apply_state_styles: third
   branch drag_over::<DragPayload>(move-closure with cloned map).
   element_needs_stateful: drag sources (non-empty drag_data) and drop
   listeners force the stateful path.
3. Renderer: dragData prop (stringify; undefined → empty=clear; markdown
   warn+drop), onDragStart/onDrop in EVENT_NAMES, dragOverStyle as the
   third branch of the state-layer prop routing.
4. Tests: renderer wire shape + clear (2); GUI smoke window_mode_drag_data_
   and_drop_listener_apply (source + drop listener + dragOver layer acks
   applied=7 through a real window; clearing batch acks applied=1); retained
   markdown rejection is covered by the existing pattern? (CHECK: did I add
   a retained unit for setDragData markdown rejection? If not, flag.)

## Invariants to actively check

- A. Lockstep: all three additions in every closed list both sides
  (events, style states, mutation ops); fixture proves the wire; encode/
  decode pair for setDragData in TS (decode exists — check encodeCommand
  irrelevant here, but encodeBatch covers mutations: verify batch.ts
  encode side handles setDragData — the P4 lesson's mutation twin).
- B. TypeId uniqueness: DragPayload is the only drag type wired; two
  different elements' drags cannot cross-match incorrectly (same type =
  intended: payload content distinguishes).
- C. Lifetimes/state: the drag_over closure OWNS its style map (cloned) —
  verify no node borrow escapes; on_drag constructor runs on the drag
  thread of gpui's event flow — confirm sink emission from there is the
  same pattern as other events (sink is Send? it writes stdout under the
  process lock — verify no deadlock when called during drag dispatch).
- D. element_needs_stateful extension: drag/drop elements previously took
  the EARLY-RETURN path (non-stateful) — the P3-B1 pattern: check BOTH the
  outer gate (element_needs_stateful) AND apply_interactive actually wire
  drag on the same element (on_drag needs a stateful element? verify gpui's
  on_drag is on InteractiveElement or Stateful — if Stateful-only, the gate
  must ensure stateful, which it does — confirm).
- E. Clearing semantics: setDragData "" clears; re-setting replaces; the
  preview label truncation is cosmetic.
- F. TDD: GUI smoke asserts acks + applied counts (not drag EVENTS — an
  actual drag gesture needs input injection; note the gap honestly).

## Evidence you can run

- bun run test (151), bun run typecheck
- cargo test -p solid-gpui-protocol -p solid-gpui-helper (31+33? + 82 + 18)
- cargo clippy --all-targets, cargo fmt --all -- --check
- Targeted: cargo test -p solid-gpui-helper --test stdio_window drag

## Verdict format

CLEAN, or Blocker/Major/Minor with path:line evidence. Focus: D (the P3
gate-sync pattern), A (mutation encode side), C (sink during drag dispatch).
