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
/// (seq, stable name) for error messages about a specific command.
fn command_ident(command: &solid_gpui_protocol::Command) -> (u32, &'static str) {
    match command {
        solid_gpui_protocol::Command::GetStats { seq } => (*seq, "getStats"),
        solid_gpui_protocol::Command::CaptureFrame { seq, .. } => (*seq, "captureFrame"),
        solid_gpui_protocol::Command::ScrollTo { seq, .. } => (*seq, "scrollTo"),
        solid_gpui_protocol::Command::GetScrollOffset { seq, .. } => (*seq, "getScrollOffset"),
        solid_gpui_protocol::Command::FocusElement { seq, .. } => (*seq, "focusElement"),
        solid_gpui_protocol::Command::SimulateInput { seq, .. } => (*seq, "simulateInput"),
        solid_gpui_protocol::Command::ListInfo { seq, .. } => (*seq, "listInfo"),
    }
}

/// Capture the helper's own window to `path` as PNG (S7b). Matches by process
/// id so overlapping dev windows of other sessions are never grabbed.
fn capture_own_window(path: &str) -> Result<serde_json::Value, String> {
    let me = std::process::id();
    let win = xcap::Window::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|w| w.pid().map(|p| p == me as u32).unwrap_or(false))
        .ok_or_else(|| format!("own window not found (pid {me})"))?;
    let image = win.capture_image().map_err(|e| e.to_string())?;
    let width = image.width();
    let height = image.height();
    image.save(path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "path": path,
        "width": width,
        "height": height,
    }))
}

enum Job {
    Batch(solid_gpui_protocol::MutationBatch),
    Command(solid_gpui_protocol::Command),
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
            Err(batch_err) => match solid_gpui_protocol::command_from_json(&line) {
                // Commands are GUI-mode features; transport mode has no
                // window, so every command answers Unsupported.
                Ok(cmd) => {
                    let (seq, name) = command_ident(&cmd);
                    Reply::Error {
                        seq: Some(seq),
                        code: ReplyCode::Unsupported,
                        message: format!(
                            "{name} requires --stdio-window; transport mode has no window"
                        ),
                    }
                }
                Err(_) => Reply::Error {
                    seq: None,
                    code: ReplyCode::DecodeFailed,
                    message: batch_err.to_string(),
                },
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
                    Err(batch_err) => {
                        match solid_gpui_protocol::command_from_json(&line) {
                            Ok(cmd) => Job::Command(cmd),
                            // Neither family decoded: report against the
                            // batch attempt (the richer error of the two).
                            Err(_) => Job::Decode(batch_err),
                        }
                    }
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
                    Job::Command(command) => match command {
                        solid_gpui_protocol::Command::GetStats { seq } => window
                            .update(cx, |view, _, _| Reply::Result {
                                seq,
                                value: view.stats_value(),
                            })
                            .unwrap_or_else(|e| Reply::Error {
                                seq: Some(seq),
                                code: ReplyCode::Unsupported,
                                message: format!("window closed: {e}"),
                            }),
                        solid_gpui_protocol::Command::CaptureFrame { seq, path } => {
                            // Capture runs outside the tree lock: it reads the
                            // composited window, not the retained tree.
                            match capture_own_window(&path) {
                                Ok(value) => Reply::Result { seq, value },
                                Err(message) => Reply::Error {
                                    seq: Some(seq),
                                    code: ReplyCode::ApplyFailed,
                                    message,
                                },
                            }
                        }
                        solid_gpui_protocol::Command::ScrollTo { seq, id, x, y } => window
                            .update(cx, |view, _window, cx| {
                                match view.scroll_to(id, x, y) {
                                    Ok(()) => {
                                        // Re-render so the new offset paints.
                                        cx.notify();
                                        Reply::Result {
                                            seq,
                                            value: serde_json::json!({ "applied": true }),
                                        }
                                    }
                                    Err(message) => Reply::Error {
                                        seq: Some(seq),
                                        code: ReplyCode::ApplyFailed,
                                        message,
                                    },
                                }
                            })
                            .unwrap_or_else(|e| Reply::Error {
                                seq: Some(seq),
                                code: ReplyCode::Unsupported,
                                message: format!("window closed: {e}"),
                            }),
                        solid_gpui_protocol::Command::GetScrollOffset { seq, id } => window
                            .update(cx, |view, _window, _cx| match view.scroll_offset(id) {
                                Some((x, y)) => Reply::Result {
                                    seq,
                                    value: serde_json::json!({ "offsetX": x, "offsetY": y }),
                                },
                                None => Reply::Error {
                                    seq: Some(seq),
                                    code: ReplyCode::ApplyFailed,
                                    message: format!("no scrollable element for id {}", id.0),
                                },
                            })
                            .unwrap_or_else(|e| Reply::Error {
                                seq: Some(seq),
                                code: ReplyCode::Unsupported,
                                message: format!("window closed: {e}"),
                            }),
                        solid_gpui_protocol::Command::FocusElement { seq, id } => window
                            .update(cx, |view, window, cx| {
                                match view.focus_element(id, window, cx) {
                                    Ok(()) => Reply::Result {
                                        seq,
                                        value: serde_json::json!({ "applied": true }),
                                    },
                                    Err(message) => Reply::Error {
                                        seq: Some(seq),
                                        code: ReplyCode::ApplyFailed,
                                        message,
                                    },
                                }
                            })
                            .unwrap_or_else(|e| Reply::Error {
                                seq: Some(seq),
                                code: ReplyCode::Unsupported,
                                message: format!("window closed: {e}"),
                            }),
                        solid_gpui_protocol::Command::SimulateInput { seq, id, text } => window
                            .update(cx, |view, _window, cx| {
                                match view.simulate_input(id, &text) {
                                    Ok(()) => {
                                        // Repaint so the caret/edits paint even
                                        // when JS never echoes the change.
                                        cx.notify();
                                        Reply::Result {
                                            seq,
                                            value: serde_json::json!({ "applied": true }),
                                        }
                                    }
                                    Err(message) => Reply::Error {
                                        seq: Some(seq),
                                        code: ReplyCode::ApplyFailed,
                                        message,
                                    },
                                }
                            })
                            .unwrap_or_else(|e| Reply::Error {
                                seq: Some(seq),
                                code: ReplyCode::Unsupported,
                                message: format!("window closed: {e}"),
                            }),
                        solid_gpui_protocol::Command::ListInfo { seq, id } => window
                            .update(cx, |view, _window, _cx| match view.list_info(id) {
                                Ok(value) => Reply::Result { seq, value },
                                Err(message) => Reply::Error {
                                    seq: Some(seq),
                                    code: ReplyCode::ApplyFailed,
                                    message,
                                },
                            })
                            .unwrap_or_else(|e| Reply::Error {
                                seq: Some(seq),
                                code: ReplyCode::Unsupported,
                                message: format!("window closed: {e}"),
                            }),
                    },
                    Job::Batch(batch) => {
                        let seq = batch.seq;
                        let mut applied: u32 = 0;
                        let mut err: Option<String> = None;
                        let mut autofocus_target: Option<solid_gpui_protocol::ElementId> = None;
                        let update_result = window.update(cx, |view, _window, cx| {
                            for m in &batch.mutations {
                                // setAnimation starts must be captured BEFORE
                                // apply (apply merges the targets into the
                                // static style, destroying the old values).
                                let pending_animation = view.prepare_animation(m);
                                match view.tree.apply(m) {
                                    Ok(()) => {
                                        applied += 1;
                                        // Materialize scroll/focus handles at
                                        // apply time so commands work before
                                        // the first paint (render-population
                                        // is lazy).
                                        if let solid_gpui_protocol::Mutation::SetStyle {
                                            id,
                                            style,
                                        } = m
                                        {
                                            view.ensure_scroll_handle(*id);
                                            view.ensure_focus_handle(*id, cx);
                                            // autoFocus: first element whose
                                            // style declares it wins; focused
                                            // once (HTML semantics).
                                            if style.contains_key("autoFocus") {
                                                autofocus_target.get_or_insert(*id);
                                            }
                                        }
                                        // Runtime animation entry: starts were
                                        // captured pre-apply (interpolated
                                        // current values when retargeting —
                                        // no jump); render substitutes them
                                        // per frame until complete.
                                        if let Some((id, entry)) = pending_animation {
                                            view.animations.insert(id, entry);
                                        }
                                        if let solid_gpui_protocol::Mutation::SetEventListener {
                                            id,
                                            ..
                                        } = m
                                        {
                                            view.ensure_focus_handle(*id, cx);
                                        }
                                        // Virtual lists: materialize state at
                                        // apply time so followTail alignment
                                        // and uniform height hints exist before
                                        // the first paint.
                                        if let solid_gpui_protocol::Mutation::CreateElement {
                                            id,
                                            element_type: solid_gpui_protocol::ElementType::List,
                                        } = m
                                        {
                                            view.ensure_list_state(*id);
                                        }
                                        if let solid_gpui_protocol::Mutation::SetStyle {
                                            id, ..
                                        } = m
                                        {
                                            view.ensure_list_state(*id);
                                        }
                                        // setValue (JS→helper controlled sync):
                                        // mirror into the live input state so
                                        // render/IME see the pushed value.
                                        if let solid_gpui_protocol::Mutation::SetValue {
                                            id,
                                            value,
                                        } = m
                                        {
                                            view.set_input_value(*id, value);
                                        }
                                        // Content changes inside a virtual
                                        // list item invalidate its cached
                                        // height: remeasure that item.
                                        if let Some(content_id) = match m {
                                            solid_gpui_protocol::Mutation::SetText {
                                                id, ..
                                            }
                                            | solid_gpui_protocol::Mutation::SetStyle {
                                                id, ..
                                            }
                                            | solid_gpui_protocol::Mutation::SetValue {
                                                id, ..
                                            } => Some(*id),
                                            _ => None,
                                        } {
                                            view.remeasure_content(content_id);
                                        }
                                    }
                                    Err(e) => {
                                        err = Some(e.to_string());
                                        break;
                                    }
                                }
                            }
                            // autoFocus target focuses on the next frame via
                            // defer_in (subscriptions activate one frame late).
                            if let Some(id) = autofocus_target {
                                view.mark_autofocus(id);
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
