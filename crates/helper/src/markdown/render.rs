// Ported from Comet (github.com/zeronsh/comet), MIT License, Copyright 2026
// Wing — with adaptations for solid-gpui (Apache-2.0; see
// THIRD_PARTY_NOTICES.md).
//
// Adaptation delta vs upstream (crates/ui/src/markdown/render.rs @ 0.2.28):
// - Theme narrowed to a fixed [`MdTheme`] value (Comet's theme crate + its
//   generation tracking dropped); element style keys (color/backgroundColor/
//   fontSize) derive the theme + a text scale at build time.
// - Streaming/veil, the cross-frame RenderCache, the copy button, and the
//   selection registry/canvas underlay are NOT ported. Inline code therefore
//   uses a square `TextRun::background_color` wash instead of the rounded
//   canvas underlay (visual polish only; layout identical).
// - No syntax highlighting yet (S13e): code lines render as one plain run.

//! BlockTree → gpui elements.
//!
//! Numbers drive layout (font sizes, line heights, paddings — all constants
//! here, scaled by the element's fontSize); colors are paint. Code blocks
//! render per-line so their height is exactly `lines × line_height`.

use gpui::{
    AnyElement, FontStyle, FontWeight, Hsla, InteractiveText, SharedString, StyledText, TextRun,
    UnderlineStyle, Window, div, font, prelude::*, px,
};
use std::ops::Range;

use super::parser::{Block, BlockTree, InlineRun, TableAlign};

/// Gap between markdown blocks (Comet mdBlockGap).
pub const MD_BLOCK_GAP: f32 = 12.0;
/// Body text size / line height (Comet: 14px / 22px).
pub const MD_TEXT_SIZE: f32 = 14.0;
pub const MD_LINE_HEIGHT: f32 = 22.0;
/// Code block metrics — height is `lines × CODE_LINE_HEIGHT + padding + header`.
pub const CODE_TEXT_SIZE: f32 = 12.5;
pub const CODE_LINE_HEIGHT: f32 = 18.0;
pub const CODE_PADDING_X: f32 = 12.0;
pub const CODE_PADDING_Y: f32 = 10.0;

// Table metrics — a port of mugen-markdown 0.6.2's `TableBlock` (via Comet)
// under a frameless hairline theme: 1px rules under the header and between
// rows are the only chrome.
/// Uniform cell padding in px.
pub const TABLE_CELL_PADDING: f32 = 12.0;
/// Hairline between rows in px.
pub const TABLE_DIVIDER: f32 = 1.0;
/// Header row font weight.
pub const TABLE_HEADER_WEIGHT: FontWeight = FontWeight::BOLD;
/// Floor for a column's max-content share (mugen MIN_COLUMN_CONTENT).
pub const TABLE_MIN_COLUMN_CONTENT: f32 = 48.0;
/// Minimum rendered column width in px, padding included.
pub const TABLE_MIN_COLUMN_WIDTH: f32 = 96.0;

/// Token-color palette for syntax highlighting: the zeron-dark 12-color set
/// (Comet crates/theme/src/builtins.rs `syntax`), mapped to all 25
/// HighlightKinds exactly like upstream's `syntax()` builder. Ported with the
/// markdown render port (MIT, Copyright 2026 Wing — see THIRD_PARTY_NOTICES).
#[derive(Debug, Clone, Copy)]
pub struct SyntaxPalette {
    pub comment: Hsla,
    pub keyword: Hsla,
    pub string: Hsla,
    pub number: Hsla,
    pub type_name: Hsla,
    pub function: Hsla,
    pub property: Hsla,
    pub variable: Hsla,
    pub punctuation: Hsla,
    pub tag: Hsla,
    pub attribute: Hsla,
    pub invalid: Hsla,
}

impl Default for SyntaxPalette {
    fn default() -> Self {
        SyntaxPalette {
            comment: gpui::rgba(0x92929aff).into(),
            keyword: gpui::rgba(0x8b7cf6ff).into(),
            string: gpui::rgba(0x34d399ff).into(),
            number: gpui::rgba(0xfacc15ff).into(),
            type_name: gpui::rgba(0xc084fcff).into(),
            function: gpui::rgba(0x60a5faff).into(),
            property: gpui::rgba(0xf472b6ff).into(),
            variable: gpui::rgba(0xe8e8eaff).into(),
            punctuation: gpui::rgba(0xa1a1aaff).into(),
            tag: gpui::rgba(0xf472b6ff).into(),
            attribute: gpui::rgba(0x22d3eeff).into(),
            invalid: gpui::rgba(0xf87171ff).into(),
        }
    }
}

impl SyntaxPalette {
    /// Paint color for a token class (upstream `Theme::color` mapping).
    pub fn color(self, kind: super::syntax::HighlightKind) -> Hsla {
        use super::syntax::HighlightKind;
        match kind {
            HighlightKind::Comment => self.comment,
            HighlightKind::Keyword => self.keyword,
            HighlightKind::String => self.string,
            HighlightKind::StringSpecial | HighlightKind::Escape => self.attribute,
            HighlightKind::Number => self.number,
            HighlightKind::Boolean => self.number,
            HighlightKind::Type | HighlightKind::TypeBuiltin | HighlightKind::Constructor => {
                self.type_name
            }
            HighlightKind::Function | HighlightKind::FunctionBuiltin => self.function,
            HighlightKind::Macro => self.keyword,
            HighlightKind::Property => self.property,
            HighlightKind::Constant => self.number,
            HighlightKind::Variable => self.variable,
            HighlightKind::VariableSpecial => self.keyword,
            HighlightKind::Parameter => self.variable,
            HighlightKind::Operator => self.keyword,
            HighlightKind::Punctuation => self.punctuation,
            HighlightKind::Tag => self.tag,
            HighlightKind::Attribute => self.attribute,
            HighlightKind::Label => self.function,
            HighlightKind::Embedded => self.punctuation,
            HighlightKind::Invalid => self.invalid,
        }
    }
}

/// Fixed default palette + fonts for markdown rendering. Comet resolves this
/// through its theme crate; solid-gpui derives it per element from the
/// node's style (see host.rs build_markdown_element).
#[derive(Debug, Clone)]
pub struct MdTheme {
    pub font_sans: SharedString,
    pub font_mono: SharedString,
    pub text: Hsla,
    pub text_muted: Hsla,
    pub accent: Hsla,
    pub border: Hsla,
    pub code_text: Hsla,
    pub code_wash: Hsla,
    pub syntax: SyntaxPalette,
}

impl Default for MdTheme {
    fn default() -> Self {
        // Catppuccin-ish dark defaults; a light background wants the
        // element style to set `color` (dark text) — muted/accent stay.
        MdTheme {
            // ".n" is gpui's platform system-UI font alias.
            font_sans: ".n".into(),
            font_mono: "Menlo".into(),
            text: gpui::rgba(0xcdd6f4ff).into(),
            text_muted: gpui::rgba(0xa6adc8ff).into(),
            accent: gpui::rgba(0x89b4faff).into(),
            border: gpui::hsla(0.0, 0.0, 1.0, 0.10),
            code_text: gpui::rgba(0xcba6f7ff).into(),
            code_wash: gpui::hsla(0.0, 0.0, 1.0, 0.06),
            syntax: SyntaxPalette::default(),
        }
    }
}

/// Monotonic id allocator for one render pass. Ids key gpui element state
/// (InteractiveText hover/click, code/table scroll handles), so they must be
/// UNIQUE within the rendered tree. Upstream derives them arithmetically
/// (`ix*100 + ci`, `ix*100 + item_ix*10 + ci`) — schemes that collide for
/// ordinary documents (a quote's second child at top-level block 0 reuses
/// the id of top-level block 1; two tables under one quote share every cell
/// id), and gpui silently SHARES state between colliding ids (no uniqueness
/// assert in 35aab21 — observed as scrollers scrolling in lockstep). A
/// pre-order counter is injective by construction and — because parse_full
/// and the traversal are deterministic — stable across re-renders of the
/// same source, and prefix-stable under appends.
#[derive(Default)]
pub struct Ids(usize);

impl Ids {
    fn next(&mut self) -> usize {
        let n = self.0;
        self.0 += 1;
        n
    }
}

/// Render a whole tree stacked with the md block gap. `row` prefixes element
/// ids (gpui needs stable ids for InteractiveText/stateful scrollers).
/// `theme.text` may be overridden by the caller from the element's `color`
/// style; `scale` is `fontSize/14` (all metrics scale linearly).
pub fn render_tree(
    row: &str,
    tree: &BlockTree,
    theme: &MdTheme,
    scale: f32,
    window: &Window,
    highlight: &dyn Fn(&str) -> Option<std::rc::Rc<super::syntax::HighlightedDocument>>,
) -> AnyElement {
    let mut ids = Ids::default();
    div()
        .flex()
        .flex_col()
        .gap(px(MD_BLOCK_GAP * scale))
        .children(tree.blocks.iter().map(|top| {
            let ix = ids.next();
            render_block(
                row, &top.block, ix, theme, scale, window, &mut ids, highlight,
            )
        }))
        .into_any_element()
}

/// Render one block (top-level or nested). `ix` is this block's id (already
/// allocated by the caller, pre-order); `ids` allocates for children.
#[allow(clippy::too_many_arguments)]
pub fn render_block(
    row: &str,
    block: &Block,
    ix: usize,
    theme: &MdTheme,
    scale: f32,
    window: &Window,
    ids: &mut Ids,
    highlight: &dyn Fn(&str) -> Option<std::rc::Rc<super::syntax::HighlightedDocument>>,
) -> AnyElement {
    match block {
        Block::Paragraph { runs } => text_element(
            row,
            runs,
            MD_TEXT_SIZE,
            MD_LINE_HEIGHT,
            false,
            ix,
            theme,
            scale,
        ),
        Block::Heading { level, runs } => {
            let (size, line) = heading_metrics(*level);
            text_element(row, runs, size, line, true, ix, theme, scale)
        }
        Block::CodeBlock { language, code } => {
            let owned = language
                .as_deref()
                .and_then(highlight)
                .map(|doc| doc.lines.clone());
            let hl = owned.as_deref();
            render_code_block(row, language.as_deref(), code, ix, theme, scale, hl)
        }
        Block::BlockQuote { children } => div()
            // Accent-tinted quote: rail + a whisper of the same hue behind it.
            .border_l_2()
            .border_color(theme.accent.opacity(0.6))
            .bg(theme.accent.opacity(0.05))
            .rounded_tr(px(6.0))
            .rounded_br(px(6.0))
            .pl(px(12.0))
            .pr(px(10.0))
            .py(px(6.0))
            .flex()
            .flex_col()
            .gap(px(8.0))
            .text_color(theme.text_muted)
            .children(children.iter().map(|child| {
                let cix = ids.next();
                render_block(row, child, cix, theme, scale, window, ids, highlight)
            }))
            .into_any_element(),
        Block::List {
            ordered_start,
            items,
        } => div()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .children(items.iter().enumerate().map(|(item_ix, item)| {
                // Accent markers: ordered numbers as tinted text, unordered
                // as a REAL 5px disc — the glyph "•" reads too small at 14px.
                let marker: gpui::AnyElement = match ordered_start {
                    Some(start) => div()
                        .flex_none()
                        .min_w(px(18.0))
                        .text_size(px(MD_TEXT_SIZE * scale))
                        .line_height(px(MD_LINE_HEIGHT * scale))
                        .text_color(theme.accent)
                        .child(SharedString::from(format!("{}.", start + item_ix as u64)))
                        .into_any_element(),
                    None => div()
                        .flex_none()
                        .min_w(px(18.0))
                        // Center the disc on the first text line's cap band.
                        .h(px(MD_LINE_HEIGHT * scale))
                        .flex()
                        .items_center()
                        .child(
                            div()
                                .ml(px(1.0))
                                .w(px(5.0))
                                .h(px(5.0))
                                .rounded_full()
                                .bg(theme.accent),
                        )
                        .into_any_element(),
                };
                div().flex().flex_row().gap(px(8.0)).child(marker).child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .children(item.iter().map(|child| {
                            let cix = ids.next();
                            render_block(row, child, cix, theme, scale, window, ids, highlight)
                        })),
                )
            }))
            .into_any_element(),
        Block::Table {
            header,
            rows,
            align,
        } => render_table(row, header, rows, align, ix, theme, scale, window, ids),
        Block::Rule => div()
            .h(px(1.0))
            .w_full()
            .bg(theme.border)
            .into_any_element(),
    }
}

/// Tight monochrome heading scale (Comet: h2 ≈ 16px semibold; headings step
/// down quickly toward body size).
fn heading_metrics(level: u8) -> (f32, f32) {
    match level {
        1 => (19.0, 27.0),
        2 => (16.0, 24.0),
        3 => (15.0, 22.0),
        _ => (14.0, 22.0),
    }
}

/// Shared per-column table geometry (port of mugen `tableColumns`).
pub struct TableColumns {
    /// Per-column max-content width, padding included.
    pub naturals: Vec<f32>,
    /// Per-column minimum width, padding included = `min(natural, minColumnWidth)`.
    pub minimums: Vec<f32>,
    /// Σ minimums — the width below which the table stops shrinking and scrolls.
    pub min_table_width: f32,
}

/// Resolve column geometry from measured per-column max-content widths
/// (content only — padding is added here).
pub fn table_columns(content_widths: &[f32]) -> TableColumns {
    let naturals: Vec<f32> = content_widths
        .iter()
        .map(|w| w.max(TABLE_MIN_COLUMN_CONTENT) + 2.0 * TABLE_CELL_PADDING)
        .collect();
    let minimums: Vec<f32> = naturals
        .iter()
        .map(|n| n.min(TABLE_MIN_COLUMN_WIDTH))
        .collect();
    let min_table_width = minimums.iter().sum();
    TableColumns {
        naturals,
        minimums,
        min_table_width,
    }
}

/// A GFM table — a port of mugen-markdown's `TableBlock` (via Comet) under a
/// frameless hairline theme (see the `TABLE_*` constants). Column widths
/// resolve exactly the way the source's CSS does: each cell is
/// `flex: <max-content> <max-content> 0; min-width: min(max-content, 96px)`.
/// Naturals come from shaping each cell's runs unwrapped; the flex resolution
/// itself is Taffy's. When even the floors no longer fit, the table scrolls
/// horizontally instead of crushing every column into per-character wrap.
#[allow(clippy::too_many_arguments)]
fn render_table(
    row: &str,
    header: &[Vec<InlineRun>],
    rows: &[Vec<Vec<InlineRun>>],
    align: &[TableAlign],
    ix: usize,
    theme: &MdTheme,
    scale: f32,
    window: &Window,
    ids: &mut Ids,
) -> AnyElement {
    // Header row first (rows may be ragged).
    let all: Vec<&[Vec<InlineRun>]> = std::iter::once(header)
        .filter(|h| !h.is_empty())
        .map(|h| h as &[Vec<InlineRun>])
        .chain(rows.iter().map(|r| r.as_slice()))
        .collect();
    let cols = all.iter().map(|r| r.len()).max().unwrap_or(0);
    if cols == 0 {
        return gpui::Empty.into_any_element();
    }
    let has_header = !header.is_empty();

    // Flatten every cell and take per-column max-content widths.
    let text_system = window.text_system();
    let mut flats: Vec<Vec<Option<FlatText>>> = Vec::with_capacity(all.len());
    let mut content = vec![0.0f32; cols];
    for (r, row_runs) in all.iter().enumerate() {
        let weight = if has_header && r == 0 {
            TABLE_HEADER_WEIGHT
        } else {
            FontWeight::NORMAL
        };
        let mut out: Vec<Option<FlatText>> = Vec::with_capacity(cols);
        for (c, natural) in content.iter_mut().enumerate() {
            let Some(runs) = row_runs.get(c) else {
                out.push(None);
                continue;
            };
            let flat = flatten_runs_weighted(runs, theme, weight);
            if !flat.text.is_empty() {
                // Cell sources are single-line; guard anyway (same byte count,
                // so the runs still cover the text exactly).
                let line: SharedString = if flat.text.contains('\n') {
                    flat.text.replace('\n', " ").into()
                } else {
                    flat.text.clone()
                };
                let width = f32::from(
                    text_system
                        .shape_line(line, px(MD_TEXT_SIZE * scale), &flat.runs, None)
                        .width(),
                );
                if width > *natural {
                    *natural = width;
                }
            }
            out.push(Some(flat));
        }
        flats.push(out);
    }
    let geo = table_columns(&content);

    // Frameless flat-hairline chrome: 1px rules under the header and between
    // rows are the only paint.
    let hairline = theme.border;
    let mut inner = div()
        .flex()
        .flex_col()
        .w_full()
        .min_w(px(geo.min_table_width * scale));
    for (r, row_flats) in flats.iter().enumerate() {
        if r > 0 {
            inner = inner.child(div().flex_none().h(px(TABLE_DIVIDER)).w_full().bg(hairline));
        }
        let mut row_el = div().flex().flex_row();
        for (c, cell_flat) in row_flats.iter().enumerate() {
            let mut cell = div()
                .flex_grow(geo.naturals[c])
                .flex_shrink(geo.naturals[c])
                .flex_basis(px(0.0))
                .min_w(px(geo.minimums[c] * scale))
                .p(px(TABLE_CELL_PADDING * scale))
                .text_size(px(MD_TEXT_SIZE * scale))
                .line_height(px(MD_LINE_HEIGHT * scale));
            cell = match align.get(c).copied().unwrap_or_default() {
                TableAlign::Left => cell,
                TableAlign::Center => cell.text_center(),
                TableAlign::Right => cell.text_right(),
            };
            if let Some(flat) = cell_flat {
                let cell_ix = ids.next();
                cell = cell.child(flat_text_element(row, flat, cell_ix));
            }
            row_el = row_el.child(cell);
        }
        inner = inner.child(row_el);
    }

    // The horizontal scroller — when the floors exceed the viewport the inner
    // block keeps `min_table_width` and this viewport scrolls it.
    let scroll_id: SharedString = format!("{row}-table{ix}").into();
    div()
        .id(scroll_id)
        .w_full()
        .overflow_x_scroll()
        .child(inner)
        .into_any_element()
}

/// Flattened inline runs: one string + gpui `TextRun`s + clickable link
/// ranges.
pub struct FlatText {
    pub text: SharedString,
    pub runs: Vec<TextRun>,
    pub links: Vec<(Range<usize>, String)>,
}

/// Flatten inline runs into shaped-text inputs. Pure given a theme.
pub fn flatten_runs(runs: &[InlineRun], theme: &MdTheme, bold_default: bool) -> FlatText {
    flatten_runs_weighted(
        runs,
        theme,
        if bold_default {
            FontWeight::SEMIBOLD
        } else {
            FontWeight::NORMAL
        },
    )
}

/// [`flatten_runs`] with an explicit base weight (table headers are 700;
/// strong runs never drop below semibold).
fn flatten_runs_weighted(runs: &[InlineRun], theme: &MdTheme, base_weight: FontWeight) -> FlatText {
    let mut text = String::new();
    let mut out: Vec<TextRun> = Vec::with_capacity(runs.len());
    let mut links: Vec<(Range<usize>, String)> = Vec::new();
    for run in runs {
        if run.text.is_empty() {
            continue;
        }
        let start = text.len();
        text.push_str(&run.text);
        let mut f = if run.style.code {
            font(theme.font_mono.clone())
        } else {
            font(theme.font_sans.clone())
        };
        f.weight = if run.style.bold && base_weight.0 < FontWeight::SEMIBOLD.0 {
            FontWeight::SEMIBOLD
        } else {
            base_weight
        };
        f.style = if run.style.italic {
            FontStyle::Italic
        } else {
            FontStyle::Normal
        };
        // Links stay monochrome — foreground with an underline (Comet's md
        // theme underlines in the text color; the accent is reserved for
        // markers/rails).
        let is_link = run.style.link.is_some();
        let color = if run.style.code {
            theme.code_text
        } else {
            theme.text
        };
        if let Some(url) = &run.style.link {
            // Merge adjacent runs of the same link into one clickable range.
            match links.last_mut() {
                Some((range, last_url)) if range.end == start && last_url == url => {
                    range.end = text.len();
                }
                _ => links.push((start..text.len(), url.clone())),
            }
        }
        out.push(TextRun {
            len: run.text.len(),
            font: f,
            color,
            // Ported delta: inline code's wash is the (square) run background
            // — Comet paints rounded quads via a canvas underlay we did not
            // port (it exists for text selection, out of scope here).
            background_color: run.style.code.then_some(theme.code_wash),
            underline: is_link.then_some(UnderlineStyle {
                color: Some(theme.text_muted),
                thickness: px(1.0),
                wavy: false,
            }),
            strikethrough: run.style.strikethrough.then_some(gpui::StrikethroughStyle {
                thickness: px(1.0),
                color: Some(theme.text_muted),
            }),
        });
    }
    FlatText {
        text: text.into(),
        runs: out,
        links,
    }
}

/// Clickable text for a flattened block (no sizing wrapper).
fn flat_text_element(row: &str, flat: &FlatText, ix: usize) -> AnyElement {
    let styled = StyledText::new(flat.text.clone()).with_runs(flat.runs.clone());
    if flat.links.is_empty() {
        styled.into_any_element()
    } else {
        let (ranges, urls): (Vec<_>, Vec<_>) = flat.links.iter().cloned().unzip();
        let id: SharedString = format!("{row}-t{ix}").into();
        InteractiveText::new(id, styled)
            .on_click(ranges, move |clicked_ix, _window, cx| {
                if let Some(url) = urls.get(clicked_ix) {
                    cx.open_url(url);
                }
            })
            .into_any_element()
    }
}

#[allow(clippy::too_many_arguments)]
fn text_element(
    row: &str,
    runs: &[InlineRun],
    size: f32,
    line_height: f32,
    bold_default: bool,
    ix: usize,
    theme: &MdTheme,
    scale: f32,
) -> AnyElement {
    let flat = flatten_runs(runs, theme, bold_default);
    let inner = flat_text_element(row, &flat, ix);
    div()
        .text_size(px(size * scale))
        .line_height(px(line_height * scale))
        .child(inner)
        .into_any_element()
}

fn render_code_block(
    row: &str,
    language: Option<&str>,
    code: &str,
    ix: usize,
    theme: &MdTheme,
    scale: f32,
    highlight: Option<&[Vec<super::syntax::HighlightSpan>]>,
) -> AnyElement {
    let mono = font(theme.font_mono.clone());
    let scroll_id: SharedString = format!("{row}-code{ix}").into();
    div()
        .rounded(px(10.0))
        // Faint white wash over the near-black panel, with the hairline
        // border.
        .bg(gpui::hsla(0.0, 0.0, 1.0, 0.035))
        .border_1()
        .border_color(theme.border)
        .overflow_hidden()
        .when_some(language, |el, lang| {
            el.child(
                div()
                    .px(px(CODE_PADDING_X * scale))
                    .py(px(5.0))
                    .border_b_1()
                    .border_color(theme.border)
                    .text_size(px(11.0 * scale))
                    .text_color(theme.text_muted)
                    .child(SharedString::from(lang.to_string())),
            )
        })
        .child(
            div()
                .id(scroll_id)
                .overflow_x_scroll()
                .px(px(CODE_PADDING_X * scale))
                .py(px(CODE_PADDING_Y * scale))
                .font_family(theme.font_mono.clone())
                .text_size(px(CODE_TEXT_SIZE * scale))
                .line_height(px(CODE_LINE_HEIGHT * scale))
                .whitespace_nowrap()
                .flex()
                .flex_col()
                // One StyledText per line keeps the block's height exactly
                // lines × line_height; horizontal overflow scrolls. Syntax
                // highlighting is recolored runs on the same mono font —
                // layout never changes (highlight is pure paint).
                .children(code.split('\n').enumerate().map(|(li, line)| {
                    let spans = highlight
                        .and_then(|h| h.get(li))
                        .map(|s| s.as_slice())
                        .unwrap_or(&[]);
                    let runs = runs_for_syntax_line(line, spans, &mono, theme);
                    div()
                        .h(px(CODE_LINE_HEIGHT * scale))
                        .flex_none()
                        .child(StyledText::new(SharedString::from(line)).with_runs(runs))
                })),
        )
        .into_any_element()
}

/// Build the exact-cover `TextRun` list for one code line from its tokens
/// (ported from Comet). Same font everywhere — recoloring can never change
/// layout; untokenized gaps take the plain code color.
pub fn runs_for_syntax_line(
    line: &str,
    spans: &[super::syntax::HighlightSpan],
    mono: &gpui::Font,
    theme: &MdTheme,
) -> Vec<TextRun> {
    let plain = |len: usize| TextRun {
        len,
        font: mono.clone(),
        color: theme.text,
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    let mut runs = Vec::new();
    let mut at = 0usize;
    for span in spans {
        if span.range.start > at {
            runs.push(plain(span.range.start - at));
        }
        let mut run = plain(span.range.len());
        run.color = theme.syntax.color(span.kind);
        runs.push(run);
        at = span.range.end;
    }
    if at < line.len() {
        runs.push(plain(line.len() - at));
    }
    runs.retain(|run| run.len > 0);
    runs
}

#[test]
fn syntax_runs_recolor_without_changing_layout() {
    use crate::markdown::syntax::{HighlightKind, HighlightRequest, highlight};

    let theme = MdTheme::default();
    let mono = font(theme.font_mono.clone());
    let line = r#"let x = "hi"; // done"#;
    let document = highlight(HighlightRequest {
        source: line,
        path: None,
        fence_tag: Some("rust"),
    })
    .unwrap();
    let runs = runs_for_syntax_line(line, &document.lines[0], &mono, &theme);
    // Exact cover of the line, single font, at least one recolored token.
    assert_eq!(runs.iter().map(|r| r.len).sum::<usize>(), line.len());
    assert!(runs.iter().all(|r| r.font == mono));
    assert!(
        runs.iter().any(|r| r.color != theme.text),
        "expected at least one token color"
    );
    // Untokenized input is one plain run.
    let plain = runs_for_syntax_line("plain text", &[], &mono, &theme);
    assert_eq!(plain.len(), 1);
    assert_eq!(plain[0].len, 10);
    // Keyword tokens take the palette keyword color (zeron-dark violet).
    let keyword_run = runs
        .iter()
        .find(|r| r.color == theme.syntax.color(HighlightKind::Keyword))
        .expect("keyword run");
    assert!(keyword_run.len < line.len());
}

#[cfg(test)]
mod tests {
    use super::super::parser::InlineStyle;
    use super::*;

    #[test]
    fn flatten_runs_maps_links_and_styles() {
        let theme = MdTheme::default();
        let runs = vec![
            InlineRun {
                text: "go ".into(),
                style: InlineStyle::default(),
            },
            InlineRun {
                text: "here".into(),
                style: InlineStyle {
                    link: Some("https://x.dev".into()),
                    ..Default::default()
                },
            },
            InlineRun {
                text: " now".into(),
                style: InlineStyle {
                    bold: true,
                    ..Default::default()
                },
            },
        ];
        let flat = flatten_runs(&runs, &theme, false);
        assert_eq!(flat.text, "go here now");
        assert_eq!(flat.links, vec![(3..7, "https://x.dev".to_string())]);
        let total: usize = flat.runs.iter().map(|r| r.len).sum();
        assert_eq!(total, flat.text.len());
        // Links stay monochrome (foreground + underline), never accent-tinted.
        assert_eq!(flat.runs[1].color, theme.text);
        assert!(flat.runs[1].underline.is_some());
        assert_eq!(flat.runs[2].font.weight, FontWeight::SEMIBOLD);
    }

    #[test]
    fn flatten_collects_code_runs_with_square_wash() {
        let theme = MdTheme::default();
        let code = |text: &str| InlineRun {
            text: text.into(),
            style: InlineStyle {
                code: true,
                ..Default::default()
            },
        };
        let runs = flatten_runs(&[code("foo"), code("()")], &theme, false);
        // Ported delta: code runs carry the square background wash (the
        // rounded canvas underlay is not ported).
        assert_eq!(runs.runs[0].background_color, Some(theme.code_wash));
        assert_eq!(runs.runs[0].color, theme.code_text);
    }

    #[test]
    fn table_columns_floor_and_padding() {
        // A short column keeps its content width (floored at
        // MIN_COLUMN_CONTENT + padding); a wide one may wrap but no narrower
        // than minColumnWidth.
        let geo = table_columns(&[10.0, 200.0]);
        assert_eq!(geo.naturals, vec![72.0, 224.0]); // 48+24, 200+24
        assert_eq!(geo.minimums, vec![72.0, 96.0]);
        assert_eq!(geo.min_table_width, 168.0);
    }

    #[test]
    fn table_columns_are_content_proportional_not_equal() {
        let geo = table_columns(&[300.0, 60.0, 60.0]);
        // Flex grow factors are the naturals — a prose column gets a larger
        // share than short ones (not equal thirds).
        assert!(geo.naturals[0] > 3.0 * geo.naturals[1] * 0.9);
        assert_eq!(geo.naturals[1], geo.naturals[2]);
    }

    #[test]
    fn table_header_flattens_at_weight_700() {
        let theme = MdTheme::default();
        let runs = vec![InlineRun {
            text: "Header".into(),
            style: InlineStyle::default(),
        }];
        let flat = flatten_runs_weighted(&runs, &theme, TABLE_HEADER_WEIGHT);
        assert_eq!(flat.runs[0].font.weight, FontWeight::BOLD);
        // Strong runs inside a 700 header stay 700 (never drop to semibold).
        let bold_runs = vec![InlineRun {
            text: "Strong".into(),
            style: InlineStyle {
                bold: true,
                ..Default::default()
            },
        }];
        let flat = flatten_runs_weighted(&bold_runs, &theme, TABLE_HEADER_WEIGHT);
        assert_eq!(flat.runs[0].font.weight, FontWeight::BOLD);
    }

    #[test]
    fn adjacent_same_link_runs_merge_into_one_range() {
        let theme = MdTheme::default();
        let style = InlineStyle {
            link: Some("https://x.dev".into()),
            ..Default::default()
        };
        let runs = vec![
            InlineRun {
                text: "bold".into(),
                style: InlineStyle {
                    bold: true,
                    ..style.clone()
                },
            },
            InlineRun {
                text: " tail".into(),
                style,
            },
        ];
        let flat = flatten_runs(&runs, &theme, false);
        assert_eq!(flat.links, vec![(0..9, "https://x.dev".to_string())]);
    }
}
