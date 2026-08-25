// Ported from Comet (github.com/zeronsh/comet), MIT License, Copyright 2026
// Wing. Adapted for solid-gpui (Apache-2.0); see THIRD_PARTY_NOTICES.md.

//! Markdown subsystem: pulldown-cmark parse (parser) → gpui elements (render),
//! with tree-sitter syntax highlighting for code blocks (syntax).

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

/// Shared per-element markdown cache map (host.rs prunes it per frame).
pub type MarkdownCaches = std::rc::Rc<
    std::cell::RefCell<
        std::collections::HashMap<solid_gpui_protocol::ElementId, MarkdownCacheEntry>,
    >,
>;
