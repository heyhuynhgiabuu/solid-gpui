# P3 review brief (r1) — key bindings (shortcuts/sequences)

## Context

Repo: solid-gpui. P3 per roadmap: desktop shortcuts through a `keys` prop
instead of competing with every onKeyDown. Recon decided AGAINST gpui's
keymap (bind_keys + Box<dyn Action> is static action dispatch, wrong shape
for JS closures) in favor of a pure string matcher on the element's own
keydown listener, scoped via the existing focus machinery. Single commit:
- 0ac4236 feat(protocol): key bindings — shortcuts and sequences (P3)
(plus artifact bookkeeping 3cc9c75 — not code)

## What changed (verify against the diff)

1. Protocol lockstep: Mutation::SetKeyBindings { id, bindings: Vec<String> }
   (lib.rs KNOWN_OPS + serde; TS mutation union + MUTATION_OPS + decodeBatch
   validation: array of non-empty strings); EventType::Keys in BOTH closed
   sets (Rust enum + KNOWN_EVENT_TYPES; TS union + EVENT_TYPES). Node gains
   key_bindings: Vec<String>; markdown rejects setKeyBindings apply-side
   (InvalidMutation, same precedent as setEventListener/setAnimation).
   Fixture batch-keys-01.json: Rust round_trip parses + re-encodes
   byte-identical; TS parity test parses/re-encodes losslessly.
2. Helper matcher (host.rs, pure functions + units):
   - canonical_keystroke(gpui::Keystroke) → "ctrl-alt-shift-cmd-key" order,
     key lowercased.
   - canonical_token: modifier aliases (control→ctrl, meta/platform/super→
     cmd, option→alt), case-insensitive; rejects modifier-only and two-key
     tokens.
   - parse_binding → KeyBindingSeq (whitespace-separated tokens).
   - advance_binding(bindings, &mut Option<(idx, matched)>, keystroke) →
     Option<fired index>: continues pending sequence; on mismatch RESETS and
     fresh-matches the stray key; single-keystroke bindings fire directly;
     stale pending index (bindings changed) resets + fresh-matches instead
     of ?-aborting.
3. Helper wiring: key_pending: Rc<RefCell<HashMap<ElementId,(usize,usize)>>>
   on HostView; the on_key_down listener re-reads bindings FROM THE TREE at
   event time (re-render swaps them live); unparseable raw entries filter in
   lockstep (parsed_ok list) so the fired index maps back to the raw string;
   element_needs_stateful extended — bindings make the element focusable
   (scoped key delivery). emit_keys reports the raw binding string via the
   `key` field of a Keys event (through the injectable sink).
4. Renderer: `keys` prop ({ binding: fn } map) → one setKeyBindings + one
   keys setEventListener; keyHandlers map demultiplexes by reported binding
   inside the single keys handler; re-set replaces the whole map (stale
   entries deleted); undefined/{} clears listener + empty bindings; markdown
   warns and drops pre-wire. keyHandlers cleared where handlers.clear() runs.

## Invariants to actively check

- A. Lockstep: both closed sets carry "keys"/setKeyBindings; unknown values
  decode-error BOTH sides with the right taxonomy; fixture proves the wire
  shape twice (Rust byte-identical + TS lossless).
- B. Focus scoping correctness: bindings fire ONLY while focused. The
  listener is on the element; gpui delivers keys to the focused element.
  Check: a non-focusable element with bindings now becomes focusable via
  element_needs_stateful — does that interact badly with tab navigation
  (it gets no tab_index; tab_stop stays false)? Reason about whether
  window-level bindings ("application-wide when not focusable" from the
  roadmap note) are ABSENT by design here and whether TODO/README claim
  otherwise anywhere.
- C. Matcher edge cases: sequence prefix sharing ("ctrl-x" alone bound AND
  "ctrl-x ctrl-s" bound — which wins on the second key?); "a a" sequences;
  case ("Cmd-K" binding vs "cmd-k" canonical); empty-string guards.
- D. State-machine lifecycle: pending entries leak? (map only grows — is a
  stale entry for a destroyed element ever cleaned? destroyed elements'
  listeners are gone so pending is unreachable — verify no correctness
  impact); bindings swap mid-sequence (stale index path).
- E. Renderer: two elements each with keys — keyHandlers keyed by
  nodeId:binding, no cross-talk; the demux handler reads event.key —
  confirm the wire event actually carries the binding in `key` (helper
  emit_keys).
- F. TDD validity + no regressions: matcher units fail without the
  implementation; renderer tests failed RED pre-implementation; existing
  suites untouched apart from additive expectations.

## Evidence you can run

- bun run test (130 expected; perf flake known — isolate before counting)
- bun run typecheck
- cargo test -p solid-gpui-protocol -p solid-gpui-helper (31 + 77 + 15 GUI)
- cargo clippy --all-targets (only pre-existing block v0.1.6 future-compat)
- cargo fmt --all -- --check

## Verdict format

CLEAN, or Blocker/Major/Minor with path:line evidence. Focus: matcher
correctness under adversarial bindings (C), scoping truth (B), lockstep (A).
