//! HostView: the GPUI view that renders the retained tree each frame.

use crate::frame_stats::FrameStats;
use gpui::{
    AnyElement, Context, Div, InteractiveElement, IntoElement, ParentElement, Point, Render, Rgba,
    ScrollHandle, SharedString, StatefulInteractiveElement, Styled, Window, div, px, rgb, rgba,
};
use solid_gpui_protocol::{ElementId, ElementType, Event, RetainedTree, StyleValue};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Write;
use std::rc::Rc;

/// Live scroll handles for scrollable nodes, keyed by element id. Lazy-created
/// at render; pruned in [`HostView::render`] once the tree drops the id. Rc /
/// RefCell because `build_element` reaches them through a `&Context`, not a
/// `&mut HostView`.
type ScrollHandles = Rc<RefCell<HashMap<ElementId, ScrollHandle>>>;

/// Which axes scroll for the `overflow` style key. Closed set — single source
/// of truth so the renderer and the protocol docs agree (AGENTS invariant 1).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ScrollAxis {
    X,
    Y,
    Both,
}

/// Parse the `overflow` style value into scroll axes; unknown values are
/// ignored (style keys are forward-compatible).
fn parse_overflow(value: &StyleValue) -> Option<ScrollAxis> {
    match value.as_str() {
        Some("scroll") => Some(ScrollAxis::Both),
        Some("scrollX") => Some(ScrollAxis::X),
        Some("scrollY") => Some(ScrollAxis::Y),
        _ => None,
    }
}

pub struct HostView {
    pub tree: RetainedTree,
    /// Build-time samples for the debug overlay and the getStats command.
    stats: FrameStats,
    /// SOLID_GPUI_DEBUG_OVERLAY=1 paints frame stats into the window.
    overlay: bool,
    scroll_handles: ScrollHandles,
}

impl HostView {
    pub fn new() -> Self {
        HostView {
            tree: RetainedTree::new(),
            stats: FrameStats::new(),
            overlay: std::env::var("SOLID_GPUI_DEBUG_OVERLAY").is_ok_and(|v| v == "1"),
            scroll_handles: Rc::new(RefCell::new(HashMap::new())),
        }
    }

    /// Wire payload for the S7b getStats command. Durations are milliseconds
    /// rounded to microseconds; percentiles describe the retained-walk build
    /// cost over the current ring window.
    pub fn stats_value(&self) -> serde_json::Value {
        let ms = |d: Option<std::time::Duration>| match d {
            Some(d) => serde_json::json!((d.as_secs_f64() * 1_000_000.0).round() / 1000.0),
            None => serde_json::Value::Null,
        };
        serde_json::json!({
            "frames": self.stats.frames(),
            "samples": self.stats.len(),
            "p50Ms": ms(self.stats.percentile(0.5)),
            "p90Ms": ms(self.stats.percentile(0.90)),
            "p95Ms": ms(self.stats.percentile(0.95)),
            "maxMs": ms(self.stats.max()),
            "lastMs": ms(self.stats.last()),
        })
    }

    /// Eagerly materialize a scroll handle when a setStyle declares an
    /// overflow scroll value — scrollTo must work before the first paint, and
    /// the map is otherwise populated lazily during render. Idempotent with
    /// the render-time get-or-create.
    pub fn ensure_scroll_handle(&self, id: ElementId) {
        if let Some(node) = self.tree.get(id) {
            if node
                .style
                .get("overflow")
                .and_then(parse_overflow)
                .is_some()
            {
                self.scroll_handles.borrow_mut().entry(id).or_default();
            }
        }
    }

    /// S8b scrollTo: move a scrollable element's retained offset. Fails when
    /// the id never rendered with an `overflow` scroll style (no handle).
    pub fn scroll_to(&self, id: ElementId, x: f64, y: f64) -> Result<(), String> {
        let handles = self.scroll_handles.borrow();
        let Some(handle) = handles.get(&id) else {
            return Err(format!(
                "no scrollable element for id {}; set overflow=scroll on it first",
                id.0
            ));
        };
        handle.set_offset(Point::new(px(x as f32), px(y as f32)));
        Ok(())
    }

    /// S8b getScrollOffset: read a scrollable element's current offset.
    pub fn scroll_offset(&self, id: ElementId) -> Option<(f64, f64)> {
        let handles = self.scroll_handles.borrow();
        let handle = handles.get(&id)?;
        let off = handle.offset();
        Some((off.x.to_f64(), off.y.to_f64()))
    }

    /// Push a click event to the JS side as one NDJSON line. The process-
    /// global stdout lock serializes this with the stdin thread's writes.
    fn emit_click(&self, id: ElementId, event: &gpui::ClickEvent) {
        let (x, y) = match event {
            gpui::ClickEvent::Mouse(m) => (
                Some(m.up.position.x.to_f64()),
                Some(m.up.position.y.to_f64()),
            ),
            _ => (None, None),
        };
        let line = solid_gpui_protocol::event_to_json(&Event::Click {
            id,
            event_type: solid_gpui_protocol::EventType::Click,
            x,
            y,
        });
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}

impl Render for HostView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let started = std::time::Instant::now();
        // Drop handles for ids the tree no longer holds (destroyed/moved).
        // Clone the Rc first so the retain closure can borrow `self.tree`
        // while the RefCell is borrowed (disjoint fields via one borrow).
        let handles = self.scroll_handles.clone();
        handles
            .borrow_mut()
            .retain(|id, _| self.tree.get(*id).is_some());
        let mut content = match self.tree.root() {
            Some(root) => build_element(&self.tree, root, cx, &self.scroll_handles),
            // No root yet: dark placeholder keeps the window alive pre-mount.
            None => div().size_full().bg(rgb(0x1e1e2e)).into_any_element(),
        };
        self.stats.push(started.elapsed());

        if !self.overlay {
            return content;
        }
        // Overlay: bottom-left stat block painted with native styling — not a
        // protocol element, so it never crosses the wire. Shows the retained-
        // walk build cost (our architecture's number), not layout/paint.
        let p95 = self
            .stats
            .percentile(0.95)
            .map(|d| format!("{:.1}", d.as_secs_f64() * 1000.0))
            .unwrap_or_else(|| "-".into());
        let last = self
            .stats
            .last()
            .map(|d| format!("{:.1}", d.as_secs_f64() * 1000.0))
            .unwrap_or_else(|| "-".into());
        let label = SharedString::from(format!(
            "build {}ms | p95 {}ms | frames {}",
            last,
            p95,
            self.stats.frames()
        ));
        content = div()
            .size_full()
            .child(content)
            .child(
                div()
                    .absolute()
                    .bottom_2()
                    .left_2()
                    .px_2()
                    .py_1()
                    .rounded_sm()
                    .bg(rgb(0x11111b))
                    .text_color(rgb(0xa6e3a1))
                    .text_size(px(11.))
                    .child(label),
            )
            .into_any_element();
        content
    }
}

/// Map one retained node to a GPUI element. Unknown style keys/values are
/// ignored (forward compatibility — see protocol StyleMap docs). Text nodes
/// render as plain GPUI text children.
fn build_element(
    tree: &RetainedTree,
    id: ElementId,
    cx: &mut Context<HostView>,
    handles: &ScrollHandles,
) -> AnyElement {
    let Some(node) = tree.get(id) else {
        return div().into_any_element();
    };
    if node.element_type == ElementType::Text {
        return SharedString::from(node.text.clone().unwrap_or_default()).into_any_element();
    }
    let mut el = div();
    for (key, value) in &node.style {
        el = apply_style(el, key, value);
    }
    for child in &node.children {
        el = el.child(build_element(tree, *child, cx, handles));
    }

    // Interactive elements must be stateful in gpui (.id()) for hit testing
    // (scroll gestures and clicks both route through interactivity). Element
    // ids are unique per tree, so one .id() serves both roles.
    let axis = node.style.get("overflow").and_then(parse_overflow);
    let has_click = node
        .listeners
        .contains(&solid_gpui_protocol::EventType::Click);
    if axis.is_none() && !has_click {
        return el.into_any_element();
    }

    // .id() requires `Into<ElementId>`: usize maps to ElementId::Integer.
    let mut el = el.id(id.0 as usize);
    if let Some(axis) = axis {
        let handle = handles.borrow_mut().entry(id).or_default().clone();
        el = el.track_scroll(&handle);
        el = match axis {
            ScrollAxis::X => el.overflow_x_scroll(),
            ScrollAxis::Y => el.overflow_y_scroll(),
            ScrollAxis::Both => el.overflow_scroll(),
        };
    }
    if has_click {
        let listener = cx.listener(move |view, event: &gpui::ClickEvent, _window, _cx| {
            view.emit_click(id, event);
        });
        el = el.on_click(listener);
    }
    el.into_any_element()
}

/// v1 style subset; unknown keys and unparsable values are ignored by design.
fn apply_style(mut el: Div, key: &str, value: &StyleValue) -> Div {
    let num = match value {
        StyleValue::Number(n) => n.as_f64(),
        StyleValue::Text(s) => parse_px(s),
    };
    match key {
        "width" => {
            if let Some(n) = num {
                el = el.w(px(n as f32));
            }
        }
        "height" => {
            if let Some(n) = num {
                el = el.h(px(n as f32));
            }
        }
        "minWidth" => {
            if let Some(n) = num {
                el = el.min_w(px(n as f32));
            }
        }
        "minHeight" => {
            if let Some(n) = num {
                el = el.min_h(px(n as f32));
            }
        }
        "padding" => {
            if let Some(n) = num {
                el = el.p(px(n as f32));
            }
        }
        "gap" => {
            if let Some(n) = num {
                el = el.gap(px(n as f32));
            }
        }
        "borderRadius" => {
            if let Some(n) = num {
                el = el.rounded(px(n as f32));
            }
        }
        "fontSize" => {
            if let Some(n) = num {
                el = el.text_size(px(n as f32));
            }
        }
        "flexGrow" => {
            if let Some(n) = num {
                el = el.flex_grow(n as f32);
            }
        }
        "flexShrink" => {
            if let Some(n) = num {
                el = el.flex_shrink(n as f32);
            }
        }
        "opacity" => {
            if let Some(n) = num {
                el = el.opacity(n as f32);
            }
        }
        "display" => {
            if value.as_str() == Some("flex") {
                el = el.flex();
            }
        }
        "flexDirection" => {
            if value.as_str() == Some("column") {
                el = el.flex_col();
            }
        }
        "alignItems" => {
            if value.as_str() == Some("center") {
                el = el.items_center();
            }
        }
        "justifyContent" => {
            if value.as_str() == Some("center") {
                el = el.justify_center();
            }
        }
        // NOTE: `overflow` is intentionally absent here — its scroll behavior
        // needs the stateful element (.overflow_*_scroll lives on
        // Stateful<Div>), so build_element wires it via parse_overflow.
        "cursor" => {
            if value.as_str() == Some("pointer") {
                el = el.cursor_pointer();
            }
        }
        "backgroundColor" => {
            if let Some(c) = parse_color(value) {
                el = el.bg(c);
            }
        }
        "color" => {
            if let Some(c) = parse_color(value) {
                el = el.text_color(c);
            }
        }
        _ => {}
    }
    el
}

/// "N" or "Npx" → N; anything else (multi-value paddings, %, units) → None (v1).
fn parse_px(s: &str) -> Option<f64> {
    let t = s.trim();
    let t = t.strip_suffix("px").unwrap_or(t);
    t.parse::<f64>().ok()
}

fn parse_color(value: &StyleValue) -> Option<Rgba> {
    let h = value.as_str()?.strip_prefix('#')?;
    match h.len() {
        6 => u32::from_str_radix(h, 16).ok().map(rgb),
        8 => u32::from_str_radix(h, 16).ok().map(rgba),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::Rgba;

    #[test]
    fn six_digit_hex_is_opaque_rgb() {
        let c = parse_color(&StyleValue::Text("#1e1e2e".into())).unwrap();
        assert_eq!(
            c,
            Rgba {
                r: 0x1e as f32 / 255.0,
                g: 0x1e as f32 / 255.0,
                b: 0x2e as f32 / 255.0,
                a: 1.0,
            }
        );
    }

    #[test]
    fn eight_digit_hex_honors_alpha_via_rgba() {
        // Regression: rgb() would drop the top byte (#rrggbb→ misrender).
        let c = parse_color(&StyleValue::Text("#ff000080".into())).unwrap();
        assert_eq!(
            c,
            Rgba {
                r: 1.0,
                g: 0.0,
                b: 0.0,
                a: 0x80 as f32 / 255.0,
            }
        );
    }

    #[test]
    fn bad_colors_are_none() {
        assert!(parse_color(&StyleValue::Text("red".into())).is_none());
        assert!(parse_color(&StyleValue::Text("#12345".into())).is_none());
        assert!(parse_color(&StyleValue::Number(5.into())).is_none());
    }

    #[test]
    fn overflow_axis_closed_set() {
        assert_eq!(
            parse_overflow(&StyleValue::Text("scroll".into())),
            Some(ScrollAxis::Both)
        );
        assert_eq!(
            parse_overflow(&StyleValue::Text("scrollX".into())),
            Some(ScrollAxis::X)
        );
        assert_eq!(
            parse_overflow(&StyleValue::Text("scrollY".into())),
            Some(ScrollAxis::Y)
        );
    }

    #[test]
    fn overflow_unknown_values_ignored() {
        assert_eq!(parse_overflow(&StyleValue::Text("auto".into())), None);
        assert_eq!(parse_overflow(&StyleValue::Text("hidden".into())), None);
        assert_eq!(parse_overflow(&StyleValue::Number(1.into())), None);
    }
}
