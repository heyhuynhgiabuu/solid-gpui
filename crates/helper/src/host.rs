//! HostView: the GPUI view that renders the retained tree each frame.

use gpui::{
    AnyElement, Context, Div, InteractiveElement, IntoElement, ParentElement, Render, Rgba,
    SharedString, StatefulInteractiveElement, Styled, Window, div, px, rgb, rgba,
};
use solid_gpui_protocol::{ElementId, ElementType, Event, RetainedTree, StyleValue};
use std::io::Write;

pub struct HostView {
    pub tree: RetainedTree,
}

impl HostView {
    pub fn new() -> Self {
        HostView {
            tree: RetainedTree::new(),
        }
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
        match self.tree.root() {
            Some(root) => build_element(&self.tree, root, cx),
            // No root yet: dark placeholder keeps the window alive pre-mount.
            None => div().size_full().bg(rgb(0x1e1e2e)).into_any_element(),
        }
    }
}

/// Map one retained node to a GPUI element. Unknown style keys/values are
/// ignored (forward compatibility — see protocol StyleMap docs). Text nodes
/// render as plain GPUI text children.
fn build_element(tree: &RetainedTree, id: ElementId, cx: &mut Context<HostView>) -> AnyElement {
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
        el = el.child(build_element(tree, *child, cx));
    }
    // Interactive elements must be stateful in gpui (.id()) for hit testing;
    // cx.listener routes the click back into this view's event emission.
    if node
        .listeners
        .contains(&solid_gpui_protocol::EventType::Click)
    {
        // .id() requires `Into<ElementId>`: usize maps to ElementId::Integer.
        let listener = cx.listener(move |view, event: &gpui::ClickEvent, _window, _cx| {
            view.emit_click(id, event);
        });
        return el.id(id.0 as usize).on_click(listener).into_any_element();
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
        "overflow" => {
            // v1: gpui scrolling is a dedicated scrollable element, not a style;
            // clip for now — real scroll arrives with the scroll element slice.
            if value.as_str() == Some("scroll") {
                el = el.overflow_y_hidden();
            }
        }
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
}
