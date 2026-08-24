//! solid-gpui helper: owns the process main thread and a native GPUI window.
//!
//! Slice 2 scope: open one window, draw a placeholder card, and optionally
//! self-quit after `--smoke <ms>` for CI-friendly verification (exit 0).
//! The mutation IPC loop arrives with Slice 3.

use std::io::{BufRead, Write};
use std::time::Duration;

use gpui::{
    App, Bounds, Context, SharedString, Window, WindowBounds, WindowOptions, div, prelude::*, px,
    rgb, size,
};
use gpui_platform::application;
use solid_gpui_protocol::{Reply, ReplyCode, reply_to_json};

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
    /// Transport mode: read NDJSON batches from stdin, reply per line, no GUI.
    stdio: bool,
    /// Quit by ourselves after this many milliseconds (smoke mode).
    smoke_ms: Option<u64>,
}

fn parse_args() -> Args {
    let mut stdio = false;
    let mut smoke_ms = None;
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--stdio" => stdio = true,
            "--smoke" => {
                smoke_ms = it.next().and_then(|v| v.parse().ok());
            }
            other => {
                eprintln!("solid-gpui-helper: unknown argument {other:?}");
                std::process::exit(2);
            }
        }
    }
    Args { stdio, smoke_ms }
}

/// Transport loop (Slice 3): batches in, replies out, no gpui. The retained
/// tree (Slice 4) will replace the `applied = decoded count` placeholder.
fn run_stdio() -> i32 {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(e) => {
                // A reader error (e.g. invalid UTF-8) is a writer bug, not EOF:
                // answer with a decode error so the JS side learns, then stop.
                let _ = writeln!(
                    out,
                    "{}",
                    reply_to_json(&Reply::Error {
                        seq: None,
                        code: ReplyCode::DecodeFailed,
                        message: format!("failed to read batch line: {e}"),
                    })
                );
                let _ = out.flush();
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match solid_gpui_protocol::from_json(&line) {
            Ok(batch) => Reply::Ack {
                seq: batch.seq,
                applied: batch.mutations.len() as u32,
            },
            Err(e) => Reply::Error {
                seq: None,
                code: ReplyCode::DecodeFailed,
                message: e.to_string(),
            },
        };
        if writeln!(out, "{}", reply_to_json(&reply)).is_err() {
            break;
        }
        if out.flush().is_err() {
            break;
        }
    }
    0
}

fn main() {
    let args = parse_args();
    if args.stdio {
        std::process::exit(run_stdio());
    }

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
                cx.update(|cx| cx.quit());
            })
            .detach();
        }
    });
}
