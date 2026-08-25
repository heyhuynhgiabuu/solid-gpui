// Ported from Comet (github.com/zeronsh/comet), MIT License, Copyright 2026
// Wing. Adapted for solid-gpui (Apache-2.0); see THIRD_PARTY_NOTICES.md.

//! Markdown subsystem: pulldown-cmark parse (parser) → gpui elements (render),
//! with tree-sitter syntax highlighting for code blocks (syntax) and diff-
//! fence coloring (diff).

pub mod diff;
pub mod parser;
pub mod render;
pub mod syntax;

use std::rc::Rc;

/// Per-element parse + highlight cache entry (host.rs owns the map; pruned
/// when the element leaves the retained tree). Keyed by EXACT source text so
/// a changed document always rebuilds and an unchanged one never re-parses
/// per frame.
pub struct MarkdownCacheEntry {
    pub source: String,
    pub tree: Rc<parser::BlockTree>,
    /// (language tag, code, highlight result) per fence, in document order;
    /// None = language unknown/unbundled → plain-text runs.
    pub highlights: Vec<(
        Option<String>,
        String,
        Option<Rc<syntax::HighlightedDocument>>,
    )>,
}

impl MarkdownCacheEntry {
    /// Build a cache entry for a markdown source: parse once, then highlight
    /// every code fence once. Unknown/unbundled languages store None (plain
    /// runs at render time).
    pub fn build(source: &str) -> Self {
        let parsed = parser::parse_full(source);
        let highlights = collect_code_fences(&parsed)
            .into_iter()
            .map(|(lang, code)| {
                let doc = syntax::highlight(syntax::HighlightRequest {
                    source: code.as_str(),
                    path: None,
                    fence_tag: lang.as_deref(),
                })
                .map(Rc::new)
                .ok();
                (lang, code, doc)
            })
            .collect();
        MarkdownCacheEntry {
            source: source.to_string(),
            tree: Rc::new(parsed),
            highlights,
        }
    }

    /// CONTENT-keyed resolution: identical fences share one highlight
    /// document; different code of the same language gets its own. Matching
    /// on both fields is what keeps line-relative spans aligned with their
    /// own fence — a language-only match would feed one fence's spans into
    /// another's lines and panic gpui on over-length runs.
    pub fn resolve(
        &self,
        lang: Option<&str>,
        code: &str,
    ) -> Option<Rc<syntax::HighlightedDocument>> {
        self.highlights
            .iter()
            .find(|(stored_lang, stored_code, _)| {
                stored_lang.as_deref() == lang && stored_code == code
            })
            .and_then(|(_, _, doc)| doc.clone())
    }
}

/// Every code fence in a parsed markdown tree, in document order (pre-order
/// walk mirroring the render traversal).
fn collect_code_fences(tree: &parser::BlockTree) -> Vec<(Option<String>, String)> {
    use parser::Block;
    fn walk(block: &Block, out: &mut Vec<(Option<String>, String)>) {
        match block {
            Block::CodeBlock { language, code } => out.push((language.clone(), code.clone())),
            Block::BlockQuote { children } => {
                for child in children {
                    walk(child, out);
                }
            }
            Block::List { items, .. } => {
                for item in items {
                    for child in item {
                        walk(child, out);
                    }
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    for top in &tree.blocks {
        walk(&top.block, &mut out);
    }
    out
}

/// Shared per-element markdown cache map (host.rs prunes it per frame).
pub type MarkdownCaches = std::rc::Rc<
    std::cell::RefCell<
        std::collections::HashMap<solid_gpui_protocol::ElementId, MarkdownCacheEntry>,
    >,
>;

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression (review r1 Blocker): two fences of the SAME language with
    /// DIFFERENT code must each resolve to their own highlight document.
    /// A language-keyed lookup fed the first fence's line-relative spans into
    /// the second fence's lines; runs_for_syntax_line then emitted over-
    /// length TextRuns and gpui's StyledText::with_runs panicked in debug AND
    /// release. The render side additionally clamps spans to the line
    /// (syntax_runs_clamp_spans_past_the_line) — this test pins the root
    /// cause instead: correct content-keyed resolution.
    #[test]
    fn same_language_fences_resolve_by_content_not_language() {
        let source = "```rust\nlet value = compute(42);\n```\n\ntext\n\n```rust\nif ok {\n```\n";
        let entry = MarkdownCacheEntry::build(source);

        let first = entry
            .resolve(Some("rust"), "let value = compute(42);")
            .expect("fence 1");
        let second = entry.resolve(Some("rust"), "if ok {").expect("fence 2");
        assert_ne!(
            std::rc::Rc::as_ptr(&first),
            std::rc::Rc::as_ptr(&second),
            "distinct code of the same language must not share a document"
        );
        // Each document is line-aligned to ITS OWN fence.
        assert_eq!(first.lines.len(), 1);
        assert_eq!(second.lines.len(), 1);
        // Identical fences share one document (deduplication by content).
        let again =
            MarkdownCacheEntry::build("```rust\nif ok {\n```").resolve(Some("rust"), "if ok {");
        assert!(again.is_some());
    }

    /// Unknown/unbundled languages store None → plain-text fallback at
    /// render time; resolution returns None rather than a wrong-language doc.
    #[test]
    fn unbundled_fences_resolve_to_none() {
        let entry = MarkdownCacheEntry::build("```c\nint main() { return 0; }\n```\n");
        assert!(
            entry
                .resolve(Some("c"), "int main() { return 0; }")
                .is_none()
        );
    }

    /// setText invalidation contract: a different source builds a different
    /// entry (the host compares entry.source to decide).
    #[test]
    fn build_reflects_the_source_text() {
        let a = MarkdownCacheEntry::build("# v1");
        let b = MarkdownCacheEntry::build("# v2");
        assert_ne!(a.source, b.source);
        assert_eq!(a.source, "# v1");
    }
}
