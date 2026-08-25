// Ported from Comet (github.com/zeronsh/comet), MIT License, Copyright 2026
// Wing — with adaptations for solid-gpui (Apache-2.0, this header satisfies
// both licenses' attribution requirements; see THIRD_PARTY_NOTICES.md).
//
// Adaptation delta vs upstream (crates/ui/src/markdown/parser.rs @ 0.2.28):
// only the full-parse path is ported. The streaming machinery
// (IncrementalParser, mend, display tree) is chat-streaming-specific and was
// left out — solid-gpui markdown elements are set once via setText (or
// replaced wholesale), so there is no append stream to optimize. The
// autolink/merge helpers are kept verbatim; their tests are ported with the
// same names so future ports can diff against upstream.

//! Block-level markdown parsing over pulldown-cmark.
//!
//! Full parses build a [`BlockTree`] — a list of top-level blocks with their
//! byte ranges in the source.

use std::ops::Range;

use pulldown_cmark::{Alignment, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag};

// ---------------------------------------------------------------------------
// Tree model
// ---------------------------------------------------------------------------

/// Inline styling flags threaded through nested emphasis/links.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct InlineStyle {
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
    pub strikethrough: bool,
    /// Destination URL when inside a link.
    pub link: Option<String>,
}

/// One run of identically-styled inline text.
#[derive(Debug, Clone, PartialEq)]
pub struct InlineRun {
    pub text: String,
    pub style: InlineStyle,
}

/// A markdown block. Containers nest.
#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Paragraph {
        runs: Vec<InlineRun>,
    },
    Heading {
        level: u8,
        runs: Vec<InlineRun>,
    },
    CodeBlock {
        language: Option<String>,
        code: String,
    },
    BlockQuote {
        children: Vec<Block>,
    },
    List {
        ordered_start: Option<u64>,
        items: Vec<Vec<Block>>,
    },
    Table {
        header: Vec<Vec<InlineRun>>,
        rows: Vec<Vec<Vec<InlineRun>>>,
        /// Per-column GFM alignment (`:--`/`:-:`/`--:`); unspecified is Left.
        align: Vec<TableAlign>,
    },
    Rule,
}

/// GFM column alignment for a table (mdast `align`; `None` renders as Left).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TableAlign {
    #[default]
    Left,
    Center,
    Right,
}

/// A top-level block plus its byte range in the source.
#[derive(Debug, Clone, PartialEq)]
pub struct TopBlock {
    pub range: Range<usize>,
    pub block: Block,
}

/// The parse result: top-level blocks in document order.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BlockTree {
    pub blocks: Vec<TopBlock>,
}

impl BlockTree {
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }

    pub fn len(&self) -> usize {
        self.blocks.len()
    }
}

// ---------------------------------------------------------------------------
// Full parse
// ---------------------------------------------------------------------------

fn options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS
}

/// Parse a whole source into a [`BlockTree`].
pub fn parse_full(source: &str) -> BlockTree {
    let events: Vec<(Event, Range<usize>)> = Parser::new_ext(source, options())
        .into_offset_iter()
        .collect();
    let mut cur = Cursor {
        events: &events,
        ix: 0,
    };
    let mut blocks = Vec::new();
    while let Some((event, range)) = cur.peek() {
        let range = range.clone();
        match event {
            Event::Rule => {
                cur.bump();
                blocks.push(TopBlock {
                    range,
                    block: Block::Rule,
                });
            }
            Event::Start(_) => {
                for block in parse_started_block(&mut cur) {
                    blocks.push(TopBlock {
                        range: range.clone(),
                        block,
                    });
                }
            }
            // Stray inline events at top level (shouldn't happen): skip.
            _ => cur.bump(),
        }
    }
    BlockTree { blocks }
}

struct Cursor<'a, 'e> {
    events: &'a [(Event<'e>, Range<usize>)],
    ix: usize,
}

impl<'a, 'e> Cursor<'a, 'e> {
    fn peek(&self) -> Option<&(Event<'e>, Range<usize>)> {
        self.events.get(self.ix)
    }

    fn peek_event(&self) -> Option<&Event<'e>> {
        self.peek().map(|(e, _)| e)
    }

    fn bump(&mut self) {
        self.ix += 1;
    }

    fn next_event(&mut self) -> Option<Event<'e>> {
        let event = self.events.get(self.ix).map(|(e, _)| e.clone());
        if event.is_some() {
            self.ix += 1;
        }
        event
    }
}

fn is_block_tag(tag: &Tag) -> bool {
    matches!(
        tag,
        Tag::Paragraph
            | Tag::Heading { .. }
            | Tag::CodeBlock(_)
            | Tag::BlockQuote(_)
            | Tag::List(_)
            | Tag::Item
            | Tag::Table(_)
            | Tag::HtmlBlock
            | Tag::FootnoteDefinition(_)
    )
}

/// Consume a `Start(tag)` and everything through its matching `End`, producing
/// block(s). Unknown containers are transparent (children splice in).
fn parse_started_block(cur: &mut Cursor) -> Vec<Block> {
    let Some(Event::Start(tag)) = cur.next_event() else {
        return Vec::new();
    };
    match tag {
        Tag::Paragraph => {
            vec![Block::Paragraph {
                runs: parse_inline_container(cur, &InlineStyle::default()),
            }]
        }
        Tag::Heading { level, .. } => vec![Block::Heading {
            level: heading_level(level),
            runs: parse_inline_container(cur, &InlineStyle::default()),
        }],
        Tag::CodeBlock(kind) => {
            let language = match kind {
                CodeBlockKind::Fenced(info) => {
                    let lang = info.split_whitespace().next().unwrap_or("");
                    if lang.is_empty() {
                        None
                    } else {
                        Some(lang.to_string())
                    }
                }
                CodeBlockKind::Indented => None,
            };
            let mut code = String::new();
            loop {
                match cur.next_event() {
                    Some(Event::Text(t)) => code.push_str(&t),
                    Some(Event::End(_)) | None => break,
                    Some(_) => {}
                }
            }
            // Fenced blocks carry a trailing newline; render per-line without it.
            if code.ends_with('\n') {
                code.pop();
            }
            vec![Block::CodeBlock { language, code }]
        }
        Tag::BlockQuote(_) => vec![Block::BlockQuote {
            children: parse_block_sequence(cur),
        }],
        Tag::List(ordered_start) => {
            let mut items = Vec::new();
            loop {
                match cur.peek_event() {
                    Some(Event::Start(Tag::Item)) => {
                        cur.bump();
                        items.push(parse_block_sequence(cur));
                    }
                    Some(Event::End(_)) | None => {
                        cur.bump();
                        break;
                    }
                    Some(_) => cur.bump(),
                }
            }
            vec![Block::List {
                ordered_start,
                items,
            }]
        }
        Tag::Table(align) => {
            let align = align
                .iter()
                .map(|a| match a {
                    Alignment::Center => TableAlign::Center,
                    Alignment::Right => TableAlign::Right,
                    Alignment::None | Alignment::Left => TableAlign::Left,
                })
                .collect();
            vec![parse_table(cur, align)]
        }
        Tag::HtmlBlock => {
            // Render raw HTML blocks as plain text.
            let mut text = String::new();
            loop {
                match cur.next_event() {
                    Some(Event::Html(t)) | Some(Event::Text(t)) => text.push_str(&t),
                    Some(Event::End(_)) | None => break,
                    Some(_) => {}
                }
            }
            let text = text.trim_end_matches('\n').to_string();
            if text.is_empty() {
                Vec::new()
            } else {
                vec![Block::Paragraph {
                    runs: vec![InlineRun {
                        text,
                        style: InlineStyle::default(),
                    }],
                }]
            }
        }
        // Transparent containers (footnote definitions when enabled, etc.).
        _ => parse_block_sequence(cur),
    }
}

/// Parse a block sequence until the container's `End` (consumed). Bare inline
/// events (tight list items) accumulate into an implicit paragraph.
fn parse_block_sequence(cur: &mut Cursor) -> Vec<Block> {
    let mut out: Vec<Block> = Vec::new();
    let mut inline_acc: Vec<InlineRun> = Vec::new();
    while let Some(event) = cur.peek_event() {
        match event {
            Event::End(_) => {
                cur.bump();
                break;
            }
            Event::Start(tag) if is_block_tag(tag) => {
                flush_paragraph(&mut out, &mut inline_acc);
                out.extend(parse_started_block(cur));
            }
            Event::Rule => {
                flush_paragraph(&mut out, &mut inline_acc);
                cur.bump();
                out.push(Block::Rule);
            }
            _ => parse_inline_event(cur, &mut inline_acc, &InlineStyle::default()),
        }
    }
    flush_paragraph(&mut out, &mut inline_acc);
    out
}

fn flush_paragraph(out: &mut Vec<Block>, acc: &mut Vec<InlineRun>) {
    if !acc.is_empty() {
        out.push(Block::Paragraph {
            runs: merge_runs(std::mem::take(acc)),
        });
    }
}

fn parse_table(cur: &mut Cursor, align: Vec<TableAlign>) -> Block {
    let mut header = Vec::new();
    let mut rows = Vec::new();
    loop {
        match cur.peek_event() {
            Some(Event::Start(Tag::TableHead)) => {
                cur.bump();
                header = parse_table_cells(cur);
            }
            Some(Event::Start(Tag::TableRow)) => {
                cur.bump();
                rows.push(parse_table_cells(cur));
            }
            Some(Event::End(_)) | None => {
                cur.bump();
                break;
            }
            Some(_) => cur.bump(),
        }
    }
    Block::Table {
        header,
        rows,
        align,
    }
}

fn parse_table_cells(cur: &mut Cursor) -> Vec<Vec<InlineRun>> {
    let mut cells = Vec::new();
    loop {
        match cur.peek_event() {
            Some(Event::Start(Tag::TableCell)) => {
                cur.bump();
                cells.push(parse_inline_container(cur, &InlineStyle::default()));
            }
            Some(Event::End(_)) | None => {
                cur.bump();
                break;
            }
            Some(_) => cur.bump(),
        }
    }
    cells
}

/// Parse inline events until the container's `End` (consumed).
fn parse_inline_container(cur: &mut Cursor, style: &InlineStyle) -> Vec<InlineRun> {
    let mut runs = Vec::new();
    while let Some(event) = cur.peek_event() {
        if matches!(event, Event::End(_)) {
            cur.bump();
            break;
        }
        parse_inline_event(cur, &mut runs, style);
    }
    // Autolink AFTER merging: pulldown splits Text events at would-be
    // emphasis chars ("…/Foo_(bar)" arrives as three events), so scanning
    // per-event would truncate URLs at every underscore.
    autolink_runs(merge_runs(runs))
}

fn parse_inline_event(cur: &mut Cursor, runs: &mut Vec<InlineRun>, style: &InlineStyle) {
    let Some(event) = cur.next_event() else {
        return;
    };
    let push = |runs: &mut Vec<InlineRun>, text: String, style: InlineStyle| {
        if !text.is_empty() {
            runs.push(InlineRun { text, style });
        }
    };
    match event {
        Event::Text(t) => push(runs, t.into_string(), style.clone()),
        Event::Code(t) => {
            let mut s = style.clone();
            s.code = true;
            push(runs, t.into_string(), s);
        }
        Event::SoftBreak => push(runs, " ".into(), style.clone()),
        Event::HardBreak => push(runs, "\n".into(), style.clone()),
        Event::Html(t) | Event::InlineHtml(t) => push(runs, t.into_string(), style.clone()),
        Event::TaskListMarker(done) => push(
            runs,
            if done { "[x] ".into() } else { "[ ] ".into() },
            style.clone(),
        ),
        Event::FootnoteReference(t) => push(runs, format!("[{t}]"), style.clone()),
        Event::Start(tag) => {
            let mut inner = style.clone();
            match tag {
                Tag::Emphasis => inner.italic = true,
                Tag::Strong => inner.bold = true,
                Tag::Strikethrough => inner.strikethrough = true,
                Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. } => {
                    inner.link = Some(dest_url.into_string());
                }
                _ => {}
            }
            runs.extend(parse_inline_container(cur, &inner));
        }
        // `End` is consumed by the container loop; anything else is ignored.
        _ => {}
    }
}

/// Promote bare `http(s)://` URLs into link runs — GFM's autolink extension,
/// which pulldown-cmark has no option for (agents paste naked PR/issue URLs
/// constantly). Runs already inside a link or code span pass through
/// untouched. Idempotent, so nested containers re-applying it on their merged
/// output is harmless.
fn autolink_runs(runs: Vec<InlineRun>) -> Vec<InlineRun> {
    let mut out = Vec::with_capacity(runs.len());
    for run in runs {
        if run.style.link.is_some() || run.style.code {
            out.push(run);
        } else {
            push_text_autolinked(&mut out, &run.text, &run.style);
        }
    }
    out
}

fn push_text_autolinked(runs: &mut Vec<InlineRun>, text: &str, style: &InlineStyle) {
    let push = |runs: &mut Vec<InlineRun>, text: &str, style: InlineStyle| {
        if !text.is_empty() {
            runs.push(InlineRun {
                text: text.to_string(),
                style,
            });
        }
    };
    let mut rest = text;
    while let Some(at) = find_url_start(rest) {
        let from = &rest[at..];
        let scheme = if from.starts_with("https://") {
            "https://".len()
        } else {
            "http://".len()
        };
        let len = bare_url_len(from);
        if len <= scheme {
            // A scheme with nothing after it stays text (don't re-find it).
            push(runs, &rest[..at + scheme], style.clone());
            rest = &from[scheme..];
            continue;
        }
        push(runs, &rest[..at], style.clone());
        let mut linked = style.clone();
        linked.link = Some(from[..len].to_string());
        push(runs, &from[..len], linked);
        rest = &from[len..];
    }
    push(runs, rest, style.clone());
}

/// First viable `http(s)://` occurrence: not glued to a preceding
/// alphanumeric (`foohttps://…` stays text, per GFM's boundary rule).
fn find_url_start(text: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(rel) = text[from..].find("http") {
        let at = from + rel;
        let after = &text[at..];
        let is_scheme = after.starts_with("http://") || after.starts_with("https://");
        let boundary = text[..at]
            .chars()
            .next_back()
            .is_none_or(|c| !c.is_alphanumeric());
        if is_scheme && boundary {
            return Some(at);
        }
        from = at + "http".len();
    }
    None
}

/// Byte length of the bare URL at the start of `text`: run to whitespace (or
/// a delimiter that never appears in pasted URLs), then trim the trailing
/// punctuation GFM excludes — a closing paren only stays when an opener
/// inside the URL balances it ("…/Foo_(bar))" keeps one, sheds one).
fn bare_url_len(text: &str) -> usize {
    let end = text
        .char_indices()
        .find(|(_, c)| c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '`'))
        .map_or(text.len(), |(i, _)| i);
    let mut url = &text[..end];
    while let Some(last) = url.chars().next_back() {
        let trim = match last {
            '.' | ',' | ';' | ':' | '!' | '?' | '*' | '_' | '~' => true,
            ')' => url.matches('(').count() < url.matches(')').count(),
            _ => false,
        };
        if !trim {
            break;
        }
        url = &url[..url.len() - last.len_utf8()];
    }
    url.len()
}

/// Merge adjacent identically-styled runs (keeps run counts small and makes the
/// tree canonical for equality tests).
fn merge_runs(runs: Vec<InlineRun>) -> Vec<InlineRun> {
    let mut out: Vec<InlineRun> = Vec::with_capacity(runs.len());
    for run in runs {
        match out.last_mut() {
            Some(last) if last.style == run.style => last.text.push_str(&run.text),
            _ => out.push(run),
        }
    }
    out
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_structure_basics() {
        let tree = parse_full("## Head\n\npara **b _bi_** text\n\n```ts\nlet x = 1;\n```\n");
        assert_eq!(tree.len(), 3);
        match &tree.blocks[0].block {
            Block::Heading { level, runs } => {
                assert_eq!(*level, 2);
                assert_eq!(runs[0].text, "Head");
            }
            other => panic!("unexpected {other:?}"),
        }
        match &tree.blocks[1].block {
            Block::Paragraph { runs } => {
                assert_eq!(runs.len(), 4); // "para ", "b ", "bi" (bold+italic), " text"
                assert!(runs[1].style.bold && !runs[1].style.italic);
                assert!(runs[2].style.bold && runs[2].style.italic);
            }
            other => panic!("unexpected {other:?}"),
        }
        match &tree.blocks[2].block {
            Block::CodeBlock { language, code } => {
                assert_eq!(language.as_deref(), Some("ts"));
                assert_eq!(code, "let x = 1;");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn nested_lists_and_tight_items() {
        let tree = parse_full("- a\n  - a1\n  - a2\n- b\n");
        let Block::List {
            ordered_start,
            items,
        } = &tree.blocks[0].block
        else {
            panic!("expected list");
        };
        assert_eq!(*ordered_start, None);
        assert_eq!(items.len(), 2);
        // Tight item text became an implicit paragraph, nested list follows.
        assert!(matches!(items[0][0], Block::Paragraph { .. }));
        assert!(matches!(items[0][1], Block::List { .. }));
    }

    #[test]
    fn tables_parse_header_and_rows() {
        let tree = parse_full("| a | b |\n|---|---|\n| 1 | 2 |\n");
        let Block::Table {
            header,
            rows,
            align,
        } = &tree.blocks[0].block
        else {
            panic!("expected table");
        };
        assert_eq!(header.len(), 2);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0][1][0].text, "2");
        assert_eq!(align, &vec![TableAlign::Left, TableAlign::Left]);
    }

    #[test]
    fn tables_parse_column_alignment() {
        let tree = parse_full("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n");
        let Block::Table { align, .. } = &tree.blocks[0].block else {
            panic!("expected table");
        };
        assert_eq!(
            align,
            &vec![TableAlign::Left, TableAlign::Center, TableAlign::Right]
        );
    }

    #[test]
    fn links_carry_urls() {
        let tree = parse_full("go to [zed](https://zed.dev) now\n");
        let Block::Paragraph { runs } = &tree.blocks[0].block else {
            panic!()
        };
        let link = runs
            .iter()
            .find(|r| r.style.link.is_some())
            .expect("link run");
        assert_eq!(link.text, "zed");
        assert_eq!(link.style.link.as_deref(), Some("https://zed.dev"));
    }

    /// The paragraph's single link run: (text, url).
    fn only_link(source: &str) -> Option<(String, String)> {
        let tree = parse_full(source);
        let Block::Paragraph { runs } = &tree.blocks[0].block else {
            panic!()
        };
        let links: Vec<_> = runs
            .iter()
            .filter_map(|r| Some((r.text.clone(), r.style.link.clone()?)))
            .collect();
        assert!(links.len() <= 1, "expected at most one link: {links:?}");
        links.into_iter().next()
    }

    /// Bare URLs autolink (the GFM extension pulldown-cmark lacks): the URL
    /// becomes a clickable run, trailing sentence punctuation stays text.
    #[test]
    fn bare_urls_autolink() {
        assert_eq!(
            only_link("PR is updated: https://github.com/zeronsh/comet/pull/31\n"),
            Some((
                "https://github.com/zeronsh/comet/pull/31".into(),
                "https://github.com/zeronsh/comet/pull/31".into()
            ))
        );
        assert_eq!(
            only_link("see https://x.dev/a, then rest.\n").map(|l| l.1),
            Some("https://x.dev/a".into())
        );
        // A wrapping paren is shed; one balanced by an opener in the path stays.
        assert_eq!(
            only_link("(docs: https://x.dev/Foo_(bar))\n").map(|l| l.1),
            Some("https://x.dev/Foo_(bar)".into())
        );
        // Bold text still autolinks, and the run keeps the emphasis.
        let tree = parse_full("**see https://x.dev now**\n");
        let Block::Paragraph { runs } = &tree.blocks[0].block else {
            panic!()
        };
        let link = runs.iter().find(|r| r.style.link.is_some()).unwrap();
        assert!(link.style.bold);
        assert_eq!(link.style.link.as_deref(), Some("https://x.dev"));
    }

    /// Non-links stay text: glued schemes, bare schemes, code spans, and the
    /// destination text of a real markdown link.
    #[test]
    fn autolink_leaves_non_urls_alone() {
        assert_eq!(only_link("foohttps://x.dev is glued\n"), None);
        assert_eq!(only_link("the https:// scheme alone\n"), None);
        assert_eq!(only_link("`https://x.dev` in code\n"), None);
        // A markdown link whose TEXT is a URL keeps the written destination.
        assert_eq!(
            only_link("[https://shown.dev](https://real.dev)\n"),
            Some(("https://shown.dev".into(), "https://real.dev".into()))
        );
    }

    #[test]
    fn top_level_ranges_are_stable_anchors() {
        let src = "first\n\nsecond\n\nthird";
        let tree = parse_full(src);
        assert_eq!(tree.len(), 3);
        assert!(
            tree.blocks
                .windows(2)
                .all(|w| w[0].range.start < w[1].range.start)
        );
        assert_eq!(&src[tree.blocks[1].range.clone()], "second\n");
    }

    #[test]
    fn empty_and_whitespace_sources() {
        assert!(parse_full("").is_empty());
        assert!(parse_full("\n\n  \n").is_empty());
    }
}
