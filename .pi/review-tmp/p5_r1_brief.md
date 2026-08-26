# P5 review brief (r1) — list alignment/overdraw + scrollToItem

## Context

Repo: solid-gpui. P5 roadmap item was written against a JS-windowed
architecture (onRange round-trips, insertedAt heuristics). OUR recon found
the retained-tree architecture already covers the substance: items live
helper-side (build_list_element render_item, host.rs ~1830), splice_range
prefix/suffix diff preserves gpui height-cache outside the changed range
for appends AND prepends (host.rs:1179), itemHeight already uses gpui's
hint semantic (pinned gpui list.rs:341 docs). The slice therefore shrank to
three real gaps. Single commit:
- 712467d feat(list): configurable alignment/overdraw + scrollToItem (P5)

## What changed (verify against the diff)

1. resolve_list_alignment (host.rs, pure): explicit listAlign "top"|
   "bottom" wins; absent → followTail implies Bottom (pre-P5 semantic);
   unknown value → falls through to the followTail rule (open-value drop).
   4 unit cases (list_alignment_tests). Wired into build_list_element,
   REPLACING the old inline `if follow_tail {Bottom} else {Top}`.
2. overdraw style key: style_num "overdraw" default 500.0, px() at BOTH
   ListState::new sites (alignment-recreate path + or_insert_with).
3. scrollToItem command (lockstep, all three places per the P4 encode
   lesson): Rust Command::ScrollToItem {seq, id, index} + KNOWN matcher +
   error-message list + command_ident + dispatch via NEW
   HostView::scroll_list_to_item (list_states stays private — list_info
   precedent; state.scroll_to(ListOffset{item_ix: index, px(0.)}) +
   cx.notify); TS union + KNOWN + decodeCommand validation (id 1..u32max,
   index >= 0) + encodeCommand branch; packages/solid/src/list.ts module
   API (scrollToItem(connection, id, index), seq namespace from 2_000_000).
4. StyleKey union gains listAlign + overdraw (authoring surface only —
   style keys are the open protocol set).
5. Tests: 4 alignment units; protocol encode/decode PAIR for scrollToItem
   (byte-exact wire assertion + invalid id/negative index rejections);
   list.test.ts fake-channel (shape + 2M namespace + decode round-trip);
   GUI smoke window_mode_scroll_to_item_applies_and_missing_list_errors —
   asserts the RESULT payload ({"applied":true}) AND the missing-list
   correlated error ({"seq":97, "no list"}), plus P5 style keys ack
   through the apply path.

## Invariants to actively check

- A. Command lockstep completeness: name in ALL lists both sides; encode
  branch exists (grep encodeCommand for scrollToItem — the P4 Blocker
  pattern); decode validation rejects bad shapes; RESULT payload shape
  matches TS expectations.
- B. Back-compat: followTail-only behavior identical to pre-P5 (alignment
  Bottom, FollowMode armed once); overdraw default 500 identical; lists
  without any new keys construct the same states as before.
- C. Alignment-recreate path: ctx.list_alignment comparison still works
  with the new resolver (the recreate-on-toggle behavior + splice baseline
  reset logic untouched?); listAlign changes BETWEEN renders flip
  alignment correctly (recreate path fires).
- D. scroll_to semantics: gpui ListState::scroll_to clamps item_ix to
  count (pinned source list.rs:660-666) — verify our error path only
  fires for NO-LIST, not out-of-range indexes (out-of-range clamps by
  design; the GUI smoke uses index 0 on a 1-item list).
- E. list.ts seq namespace 2M vs desktop 1M vs renderer batches 1.. —
  disjoint; wrap documented.
- F. TDD: alignment units were RED first (function didn't exist);
  encode/decode pair mirrors the P4 regression pattern.

## Evidence you can run

- bun run test (147), bun run typecheck
- cargo test -p solid-gpui-protocol -p solid-gpui-helper (32 + 80 + 16 GUI)
- cargo clippy --all-targets (only pre-existing block v0.1.6), cargo fmt
- Targeted: cargo test -p solid-gpui-helper list_alignment; bun test
  packages/solid/src/list.test.ts (per the session's test-filter workflow)

## Verdict format

CLEAN, or Blocker/Major/Minor with path:line evidence. Focus: A (the P4
lesson applied), B (back-compat of the default paths), C (recreate path).
