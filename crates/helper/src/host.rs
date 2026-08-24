//! HostView: the GPUI view that renders the retained tree each frame.

use gpui::{
    AnyElement, Context, Div, IntoElement, ParentElement, Render, SharedString, Styled, Window,
    div, px, rgb,
};
use solid_gpui_protocol::{ElementId, ElementType, RetainedTree, StyleValue};

pub struct HostView {
    pub tree: RetainedTree,
}

impl HostView {
    pub fn new() -> Self {
        HostView {
            tree: RetainedTree::new(),
        }
    }
}

impl Render for HostView {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        match self.tree.root() {
            Some(root) => build_element(&self.tree, root),
            // No root yet: dark placeholder keeps the window alive pre-mount.
            None => div().size_full().bg(rgb(0x1e1e2e)).into_any_element(),
        }
    }
}

/// Map one retained node to a GPUI element. Unknown style keys/values are
/// ignored (forward compatibility — see protocol StyleMap docs). Text nodes
/// render as plain GPUI text children.
fn build_element(tree: &RetainedTree, id: ElementId) -> AnyElement {
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
        el = el.child(build_element(tree, *child));
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
            if let Some(c) = value.as_str().and_then(parse_hex) {
                el = el.bg(rgb(c));
            }
        }
        "color" => {
            if let Some(c) = value.as_str().and_then(parse_hex) {
                el = el.text_color(rgb(c));
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

/// "#rrggbb" or "#rrggbbaa" → u32.
fn parse_hex(s: &str) -> Option<u32> {
    let h = s.strip_prefix('#')?;
    match h.len() {
        6 | 8 => u32::from_str_radix(h, 16).ok(),
        _ => None,
    }
}
