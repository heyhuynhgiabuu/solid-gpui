//! solid-gpui helper: owns the process main thread and a native GPUI window.
//!
//! Slice 2 scope: open one window, draw a placeholder card, and optionally
//! self-quit after `--smoke <ms>` for CI-friendly verification (exit 0).
//! The mutation IPC loop arrives with Slice 3.

use std::time::Duration;

use gpui::{
    App, Bounds, Context, SharedString, Window, WindowBounds, WindowOptions, div, prelude::*, px,
    rgb, size,
};
use gpui_platform::application;

struct HelperView {
    label: SharedString,
}

impl Render for HelperView {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap_3()
            .justify_center()
            .items_center()
            .bg(rgb(0x1e1e2e))
            .size_full()
            .text_xl()
            .text_color(rgb(0xffffff))
            .child(self.label.clone())
            .child(
                div()
                    .text_sm()
                    .text_color(rgb(0x9f9fb8))
                    .child("helper online — renderer connects in slice 3"),
            )
    }
}

struct Args {
    /// Quit by ourselves after this many milliseconds (smoke mode).
    smoke_ms: Option<u64>,
}

fn parse_args() -> Args {
    let mut smoke_ms = None;
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--smoke" => {
                smoke_ms = it.next().and_then(|v| v.parse().ok());
            }
            other => {
                eprintln!("solid-gpui-helper: unknown argument {other:?}");
                std::process::exit(2);
            }
        }
    }
    Args { smoke_ms }
}

fn main() {
    let args = parse_args();

    application().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(480.), px(360.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| {
                cx.new(|_| HelperView {
                    label: "solid-gpui".into(),
                })
            },
        )
        .unwrap();
        cx.activate(true);

        if let Some(ms) = args.smoke_ms {
            cx.spawn(async move |cx| {
                cx.background_executor()
                    .timer(Duration::from_millis(ms))
                    .await;
                let _ = cx.update(|cx| cx.quit());
            })
            .detach();
        }
    });
}
