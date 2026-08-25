# S13f Round-1 Review Brief (diff-fence rendering)

READ-ONLY review. Repo: /Users/huynhgiabuu/dev/projects/solid-gpui (main).
Modify nothing anywhere.

Deliverable: verdict CLEAN / FINDINGS-SHOULD-FIX / NOT MERGEABLE; every
finding tagged blocker/major/minor/note with path:line + quoted code;
report the ACTUAL results of the verification commands you run.

## Context

solid-gpui: Solid 2 → NDJSON protocol → Rust helper → GPUI. S13 added a
markdown element ported from Comet (MIT, Copyright 2026 Wing) — parser,
renderer, tree-sitter syntax highlighting all reviewed CLEAN in prior
rounds. S13f adds diff-fence rendering: ```diff / ```patch fences render
each line with a conventional row wash + text tone instead of tree-sitter
tokenization. This deliberately ports ONLY the per-line classification core
of Comet's changes.rs (LineKind Add/Del/Hunk/Meta/Context); the 5000-line
Changes pane (watch streams, branch scopes, comments, folds, split layout)
is app-coupled Comet machinery and stays unported by design.

The slice commit is the latest feat(helper) commit on main
(`git log --oneline -3`).

## What changed

1. crates/helper/src/markdown/diff.rs (NEW): DiffLineKind enum +
   classify(line) prefix classifier (+/-/@@/diff--git/index/+++/---/\\
   markers; order matters — +++/--- checked before +/-; @@ before both).
   Two test fns (prefix mapping incl. \\ No-newline and empty line;
   prefix-only markers).
2. crates/helper/src/markdown/render.rs:
   - MdTheme gains diff_add/diff_add_wash/diff_del/diff_del_wash
     (emerald-400 0x34d399 / red-400 0xf87171 at ~15% alpha washes —
     upstream theme.diff_add/diff_del families from builtins.rs).
   - is_diff_fence(language): "diff" | "patch" closed set.
   - diff_line_paint: kind → (wash, text tone); Hunk = code_wash + accent
     text; Meta = no wash + muted.
   - render_code_block's per-line children branch on is_diff_fence BEFORE
     the syntax path: wash rows use negative mx + compensating px for a
     full-bleed wash inside the padded body; Context keeps theme.text;
     runs are single plain runs (no tokenization).
3. Window smoke window_mode_renders_markdown_element now mounts a ```diff
   fence (ack + frames + setText swap still asserted). Demo DOC_B gained a
   diff fence; DOC_A table row unchanged... check examples/markdown.ts.

## Review priorities

1. Classifier correctness vs real unified diffs: any prefix that
   misclassifies? (e.g. "+++ b/x" is Meta not Add; "--- a/x" Meta not Del;
   "@@" anywhere but prefix; content lines starting with whitespace;
   "\\ No newline"). Compare against upstream changes.rs classification
   (~lines 344-390 in ~/dev/scratch/comet-s13/crates/ui/src/changes.rs)
   and against `git diff` output conventions.
2. Layout honesty: washes via negative mx/px must not change line height or
   horizontal scroll width (the code body is whitespace_nowrap overflow_x_
   scroll — does negative margin affect scroll extent or clip?).
3. Palette consistency: wash/text pairs readable on the dark code surface;
   hunk uses accent+code_wash — consistent with the rest of MdTheme?
4. Attribution scope: diff.rs header claims LineKind-only port — verify
   that claim matches reality (no other changes.rs machinery copied);
   THIRD_PARTY_NOTICES.md wording still accurate given this new file.
5. Tests adequate for the classifier? Anything untested that could break
   silently (e.g. CRLF line endings leaving \r so "+"-prefix tests still
   pass but trailing \r lands in the run)?
6. Regressions: non-diff fences must be pixel-identical to before (syntax
   path untouched); window smoke green.

## Verification recipe

cd /Users/huynhgiabuu/dev/projects/solid-gpui
- bun --conditions=browser test
- cargo test -p solid-gpui-protocol -p solid-gpui-helper
  (macOS window flake under parallel load documented-known; rerun failing
  window test in isolation first)
- cargo clippy --all-targets -p solid-gpui-helper -p solid-gpui-protocol
Upstream reference: ~/dev/scratch/comet-s13/crates/ui/src/changes.rs.

## Non-goals

Split layout, fold/collapse, comment cards, watch streams, patch parser
object model, inner-code syntax highlighting inside diff lines, README.

Stop after the verdict.
