//! Smoke behavior of the helper binary: `--smoke <ms>` opens a window and
//! self-quits with exit 0; unknown arguments exit 2.
//!
//! Opens a real window briefly (needs a GUI session); skip headless via
//! `SOLID_GPUI_SKIP_GUI_TESTS=1`.

use std::process::Command;

fn skip() -> bool {
    std::env::var("SOLID_GPUI_SKIP_GUI_TESTS").is_ok()
}

#[test]
fn smoke_mode_quits_cleanly() {
    if skip() {
        return;
    }
    let bin = env!("CARGO_BIN_EXE_solid-gpui-helper");
    let start = std::time::Instant::now();
    let status = Command::new(bin)
        .arg("--smoke")
        .arg("800")
        .status()
        .expect("helper binary spawns");
    let elapsed = start.elapsed();
    assert!(status.success(), "smoke run must exit 0, got {status}");
    assert!(
        elapsed >= std::time::Duration::from_millis(700),
        "quit came too early ({elapsed:?}) — smoke timer ignored?"
    );
}

#[test]
fn unknown_argument_is_rejected() {
    let bin = env!("CARGO_BIN_EXE_solid-gpui-helper");
    let status = Command::new(bin).arg("--nope").status().expect("spawns");
    assert_eq!(status.code(), Some(2), "unknown arg must exit 2");
}
