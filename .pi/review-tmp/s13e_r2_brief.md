# S13e Round-2 Review Brief (fixes for round-1 findings)

READ-ONLY review. Repo: /Users/huynhgiabuu/dev/projects/solid-gpui (main).
Modify nothing anywhere.

Deliverable: verdict CLEAN / FINDINGS-SHOULD-FIX / NOT MERGEABLE; every
finding tagged blocker/major/minor/note with path:line + quoted code;
report the ACTUAL results of the verification commands you run.

## Context

Round 1 (task mt8gbici-7028) reviewed the S13e syntax-highlighting slice
and returned NOT MERGEABLE with one Blocker + 2 Minors + 2 Notes. The
implementer claims every finding is fixed in the latest fix commit on main
(`git log --oneline -3`; the fix is the one titled "content-keyed highlight
resolution + span clamping").

## Round-1 findings → claimed fixes

BLOCKER: the highlight resolver matched only the language tag — two fences
of the same language with different code resolved to the FIRST fence's
document; line-relative spans exceeded the second fence's line lengths and
gpui StyledText::with_runs panics on over-length runs in debug AND release.
Claimed fix:
- MarkdownCacheEntry::build(source) + resolve(lang, code) in
  crates/helper/src/markdown/mod.rs: the entry owns parse/highlight
  construction and CONTENT-keyed lookup matching BOTH fields.
- render.rs resolver signature is now (Option<&str>, &str) and passes the
  fence's own code; HighlightResolver type alias introduced.
- Defensive clamp in runs_for_syntax_line: spans are clamped to line.len()
  so a future resolver bug can only mis-color, never over-length a run.
- Tests: same_language_fences_resolve_by_content_not_language,
  unbundled_fences_resolve_to_none, build_reflects_the_source_text (in
  markdown/mod.rs), syntax_runs_clamp_spans_past_the_line (render.rs —
  RED observed pre-fix).

Minor 1: demo python/yaml fences were claimed but absent. Claimed fix:
added to DOC_B in examples/markdown.ts (escaped backticks), DOC_A table row
updated to done, S13e checklist item updated.

Minor 2: THIRD_PARTY_NOTICES.md under-inclusive. Claimed fix: now lists
crates/syntax/src/lib.rs and crates/theme/src/builtins.rs sources.

Note 1: upstream minified_lines perf test dropped. Claimed fix: re-ported.

Note 2: no host-level cache/resolver tests (how the Blocker slipped).
Partially addressed by the MarkdownCacheEntry unit tests above (they test
the production resolve path); host-side pruning itself remains covered only
by the render-loop retain call shared with three other maps.

## Review priorities

1. Blocker fix completeness: trace render.rs resolver threading end-to-end
   (render_tree → render_block → CodeBlock arm passes BOTH lang and code);
   confirm no remaining language-only lookup anywhere; confirm identical
   fences still share docs and different code never does.
2. Clamp correctness: runs_for_syntax_line exact cover holds for arbitrary
   span inputs (empty spans, spans fully past len, zero-length lines);
   confirm clamped output can never exceed line.len().
3. Cache lifecycle unchanged and sound: entry.source comparison, per-frame
   pruning, borrow discipline in build_markdown_element's closure.
4. Minors/notes verified as claimed.
5. New regressions from the fixes themselves (clippy, fmt, signatures).

## Verification recipe

cd /Users/huynhgiabuu/dev/projects/solid-gpui
- bun --conditions=browser test
- cargo test -p solid-gpui-protocol -p solid-gpui-helper
  (macOS window flake under parallel load is documented-known; rerun a
  failing window test in isolation before counting it)
- cargo clippy --all-targets -p solid-gpui-helper -p solid-gpui-protocol
Read markdown/mod.rs, render.rs, host.rs markdown sections end-to-end.
Upstream reference: ~/dev/scratch/comet-s13/crates/syntax/src/lib.rs.

## Non-goals

Streaming/async highlighting, unbundled grammars, diff rendering, README.

Stop after the verdict.
