//! solid-gpui helper: owns the process main thread and a native GPUI window.
//!
//! Modes:
//! - `--stdio`          transport only: NDJSON batches in, replies out, no GUI
//! - `--stdio-window`   transport + a GPUI window rendering the retained tree
//!   (real `applied` counts; apply errors are seq-correlated)
//! - `--smoke <ms>`     open a window, self-quit (CI verification)

mod frame_stats;
mod host;

use std::io::{BufRead, Write};
use std::time::Duration;

use futures::StreamExt;
use futures::channel::mpsc;
use gpui::{App, Bounds, WindowBounds, WindowOptions, prelude::*, px, size};
use gpui_platform::application;
use solid_gpui_protocol::{ProtocolError, Reply, ReplyCode, reply_to_json};

use crate::host::HostView;

struct Args {
    stdio: bool,
    stdio_window: bool,
    smoke_ms: Option<u64>,
}

fn parse_args() -> Args {
    let mut stdio = false;
    let mut stdio_window = false;
    let mut smoke_ms = None;
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--stdio" => stdio = true,
            "--stdio-window" => stdio_window = true,
            "--smoke" => {
                smoke_ms = it.next().and_then(|v| v.parse().ok());
            }
            other => {
                eprintln!("solid-gpui-helper: unknown argument {other:?}");
                std::process::exit(2);
            }
        }
    }
    Args {
        stdio,
        stdio_window,
        smoke_ms,
    }
}

fn main() {
    let args = parse_args();
    if args.stdio {
        std::process::exit(run_stdio());
    }
    if args.stdio_window {
        run_stdio_window();
        return;
    }

    application().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(480.), px(360.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            |_, cx| cx.new(|_| HostView::new()),
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

/// One decoded-or-failed batch line, sent from the stdin thread to the GPUI
/// main thread.
enum Job {
    Batch(solid_gpui_protocol::MutationBatch),
    Decode(ProtocolError),
}

/// Transport loop (no GUI): batches in, replies out, EOF exits 0. The
/// retained tree does not exist here; `applied` is the decoded count.
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

/// Transport + window mode. A dedicated thread owns stdin/stdout; the GPUI
/// main thread owns the retained tree. Channels in between: jobs one way,
/// replies the other (synchronous request/reply per line preserves order).
fn run_stdio_window() {
    application().run(|cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(480.), px(360.0)), cx);
        let window = cx
            .open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    ..Default::default()
                },
                |_, cx| cx.new(|_| HostView::new()),
            )
            .unwrap();
        cx.activate(true);

        cx.on_window_closed(|cx, _window_id| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();

        let (job_tx, job_rx) = mpsc::unbounded::<Job>();
        let (reply_tx, reply_rx) = std::sync::mpsc::channel::<Reply>();

        std::thread::spawn(move || {
            let stdin = std::io::stdin();
            let stdout = std::io::stdout();
            // DEADLOCK INVARIANT: never hold the stdout lock across a blocking
            // read. The GPUI main thread writes click events under the same
            // process-global lock (host.rs emit_click); a lock held across
            // `stdin.lock().lines()` would freeze the window on first click.
            // Scope each reply write instead — lines cannot interleave because
            // a full line + flush completes before the lock drops.
            for line in stdin.lock().lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(e) => {
                        let mut out = stdout.lock();
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
                let job = match solid_gpui_protocol::from_json(&line) {
                    Ok(batch) => Job::Batch(batch),
                    Err(e) => Job::Decode(e),
                };
                if job_tx.unbounded_send(job).is_err() {
                    break; // main loop gone
                }
                // Wait for this job's reply to keep strict line ordering.
                match reply_rx.recv() {
                    Ok(reply) => {
                        let mut out = stdout.lock();
                        if writeln!(out, "{}", reply_to_json(&reply)).is_err()
                            || out.flush().is_err()
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            // EOF or broken pipe: dropping job_tx ends the main loop below.
        });

        cx.spawn(async move |cx| {
            let mut job_rx = job_rx;
            while let Some(job) = job_rx.next().await {
                let reply = match job {
                    Job::Decode(e) => Reply::Error {
                        seq: None,
                        code: ReplyCode::DecodeFailed,
                        message: e.to_string(),
                    },
                    Job::Batch(batch) => {
                        let seq = batch.seq;
                        let mut applied: u32 = 0;
                        let mut err: Option<String> = None;
                        let update_result = window.update(cx, |view, _window, cx| {
                            for m in &batch.mutations {
                                match view.tree.apply(m) {
                                    Ok(()) => applied += 1,
                                    Err(e) => {
                                        err = Some(e.to_string());
                                        break;
                                    }
                                }
                            }
                            cx.notify();
                        });
                        if let Err(e) = update_result {
                            // Window closed mid-stream: report instead of
                            // acking an empty batch (process is exiting anyway).
                            Reply::Error {
                                seq: Some(seq),
                                code: ReplyCode::ApplyFailed,
                                message: format!("window closed: {e}"),
                            }
                        } else {
                            match err {
                                None => Reply::Ack { seq, applied },
                                Some(message) => Reply::Error {
                                    seq: Some(seq),
                                    code: ReplyCode::ApplyFailed,
                                    message: format!(
                                        "apply failed after {applied} mutations: {message}"
                                    ),
                                },
                            }
                        }
                    }
                };
                let _ = reply_tx.send(reply);
            }
            // Channel closed = stdin EOF: quit the app cleanly.
            cx.update(|cx| cx.quit());
        })
        .detach();
    });
}
