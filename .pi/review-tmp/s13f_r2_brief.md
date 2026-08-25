# S13f Round-2 Review Brief (fixes for round-1 findings)

READ-ONLY review. Repo: /Users/huynhgiabuu/dev/projects/solid-gpui (main).
Modify nothing anywhere.

Deliverable: verdict CLEAN / FINDINGS-SHOULD-FIX / NOT MERGEABLE; every
finding tagged blocker/major/minor/note with path:line + quoted code;
report the ACTUAL results of the verification commands you run.

## Context

Round 1 (task mt8hdejr-d712) reviewed the S13f diff-fence slice and
returned FINDINGS-SHOULD-FIX with 2 minors + 3 notes. The implementer
claims all are fixed in the latest fix commit on main (`git log --oneline
-3`; the fix commit is titled "diff classifier space gate + stretch-based
washes").

## Round-1 findings → claimed fixes

Minor 1 (diff.rs classify): `starts_with("+++")`/`("---")` misclassified
ADDED content beginning with `++` (e.g. `+++i;` → Meta instead of Add).
Claimed fix: space-gate on `"+++ "`/`"--- "` (git headers always carry the
trailing space); plumbing lines (new file mode, deleted file mode, rename
from/to, copy from/to, Binary files, similarity index, old/new mode) moved
to Meta; header-shaped content (`+++ path`) documented as an unavoidable
stateless limit and pinned by test. New regression tests:
content_starting_with_marker_runs_stays_add_or_del + expanded prefix map.

Minor 2 (render.rs): washed rows used `.mx(-pad).px(pad)` for full-bleed,
inflating gpui children-bounds scroll extent by 2×padding. Claimed fix:
negative margins removed; rows rely on taffy's default cross-axis stretch
so wash width = body content width honestly.

Note fixes also claimed: is_diff_fence now case-insensitive (GFM info
strings); THIRD_PARTY_NOTICES.md lists crates/ui/src/changes.rs as diff.rs
source. Wash alpha kept at ~15% deliberately (small-fence legibility vs
upstream ~6%) — judgment call, not a defect claim.

## Review priorities

1. Verify Minor 1 fix: classify("+++i;") → Add; classify("--- a/x") →
   Meta; classify("---") → Del; header-shaped "+++ b/f.txt" → Meta
   (documented). Any NEW misclassification introduced by the space gate or
   the expanded plumbing list?
2. Verify Minor 2 fix: negative margins gone from render.rs diff branch;
   reason carefully about taffy cross-axis stretch inside this specific
   container chain (flex_col + whitespace_nowrap + overflow_x_scroll):
   do washed rows actually span the visible content width? Is scroll
   extent exactly max-line-width now?
3. Confirm no regressions to non-diff fences (syntax path byte-identical)
   and that all new/updated tests pin the fixed behaviors.
4. Suites green (run them yourself).

## Verification recipe

cd /Users/huynhgiabuu/dev/projects/solid-gpui
- bun --conditions=browser test
- cargo test -p solid-gpui-protocol -p solid-gpui-helper
  (macOS window flake under parallel load documented-known; rerun failing
  window test in isolation first)
- cargo clippy --all-targets -p solid-gpui-helper -p solid-gpui-protocol

## Non-goals

Everything round 1 passed (classifier core correctness beyond the two
minors, palette readability judgment, smoke adequacy); split layout/
comments/folds; README.

Stop after the verdict.
