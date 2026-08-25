# S13e Round-1 Review Brief (syntax highlighting port)

READ-ONLY review. Repo: /Users/huynhgiabuu/dev/projects/solid-gpui (main).
Modify nothing anywhere.

Deliverable: verdict CLEAN / FINDINGS-SHOULD-FIX / NOT MERGEABLE; every
finding tagged blocker/major/minor/note with path:line + quoted code;
report the ACTUAL results of the verification commands you run.

## Context

solid-gpui: Solid 2 → NDJSON mutation protocol → out-of-process Rust helper
(crates/helper) → GPUI windows. S13 added a markdown element (parser +
renderer ported from Comet, MIT, Copyright 2026 Wing — already reviewed
CLEAN in two rounds). S13e adds syntax highlighting for markdown code
blocks: a port of Comet's standalone crates/syntax (tree-sitter) plus
render/host wiring. The commit under review is HEAD (see `git log --oneline -3`;
the S13e commit is the feat(helper) one touching crates/helper/src/markdown/syntax.rs).

## What changed

1. crates/helper/src/markdown/syntax.rs (NEW): port of Comet
   crates/syntax/src/lib.rs @0.2.28 with documented adaptations:
   - thiserror dropped → manual Display/Error.
   - Bundled grammar subset: rust/js/jsx/ts/tsx/python/go/json/jsonc/bash/
     toml/yaml/css/html (11 grammar crates + tree-sitter + highlight).
     Other LanguageId variants exist but is_bundled()=false → typed
     GrammarUnavailable error; render falls back to plain text.
   - Markdown-as-parent dropped (pulldown-cmark owns doc parsing; fences
     resolve directly). Html keeps js/css/json injections.
   - Grammar crate versions pinned exactly like upstream Comet (=0.26.11
     etc.) because constant names differ between releases.
2. crates/helper/src/markdown/render.rs: SyntaxPalette (zeron-dark 12
   colors mapped to all 25 kinds), runs_for_syntax_line (exact-cover TextRun
   list per line, single mono font), render_code_block consumes per-line
   spans; render_tree takes a content-keyed resolver
   Fn(&str fence_tag) -> Option<Rc<HighlightedDocument>>.
3. crates/helper/src/host.rs: MarkdownCacheEntry {source: String,
   tree: Rc<BlockTree>, highlights: Vec<(lang, code, Option<Rc<doc>>)>} per
   markdown element id in a MarkdownCaches map on HostView (pruned each
   frame like scroll/focus/input maps); recomputed when source text differs;
   build_markdown_element threads a content-keyed resolver closure into
   render_tree. collect_code_fences walks the parse tree pre-order.
4. crates/helper/src/markdown/mod.rs: MarkdownCacheEntry + MarkdownCaches
   type aliases.
5. examples/markdown.ts: python + yaml fences added.
6. Tests: 12 syntax unit tests ported (aliases/paths/shebang, span
   validation incl. UTF-8 boundary, overlap normalization precedence,
   limits/unbundled typed errors, rust structural categories, rust
   multiline/unicode/incomplete, bundled-grammar fixture loop, html
   injection, jsonc comments); 1 render test
   (syntax_runs_recolor_without_changing_layout).

## Review priorities

1. Port fidelity/attribution: syntax.rs header accurate vs
   ~/dev/scratch/comet-s13/crates/syntax/src/lib.rs; no unported hunk left
   misattributed; THIRD_PARTY_NOTICES.md still sufficient.
2. Correctness of the cache lifecycle (host.rs): entry keyed by element id,
   compared by exact source; pruned per frame via tree.get(id).is_some();
   any path where the cache can go stale relative to the retained node's
   text? Any borrow hazard (RefCell borrow held across re-entrant mutation)?
   Unbounded growth paths?
3. Id/state interactions: code-block scroll ids unchanged (counter scheme);
   highlighting must not change layout (same font, exact cover) — check
   runs_for_syntax_line covers every byte and never changes font.
4. Resolver semantics: content-keyed (language+code) — duplicate fences
   share docs; a fence whose language tag differs but code identical gets
   its own doc; nested fences (quote/list) resolve identically to top-level.
5. Error/fallback honesty: unknown or unbundled language → plain text, no
   panic, no wire impact; limits enforced.
6. Tests adequacy: do the ported tests pin the behaviors above; anything
   critical untested (e.g. cache invalidation on setText)?

## Verification recipe

cd /Users/huynhgiabuu/dev/projects/solid-gpui
- bun --conditions=browser test
- cargo test -p solid-gpui-protocol -p solid-gpui-helper
  (macOS window flake under parallel load is documented-known; rerun a
  failing window test in isolation before counting it)
- cargo clippy --all-targets -p solid-gpui-helper -p solid-gpui-protocol
Compare against ~/dev/scratch/comet-s13/crates/syntax/src/lib.rs and
crates/theme/src/builtins.rs (palette mapping) as needed.

## Non-goals

Streaming/incremental highlight, async highlight workers (v1 caches are
synchronous), diff rendering, unbundled grammars, README updates.

Stop after the verdict.
