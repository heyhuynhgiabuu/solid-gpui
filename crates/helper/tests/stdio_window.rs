//! `--stdio-window` end-to-end: a real GPUI window driven by stdio batches.
//! GUI-gated (needs a window server); skip headless via
//! `SOLID_GPUI_SKIP_GUI_TESTS=1`.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use solid_gpui_protocol::{from_json, to_json};

fn skip() -> bool {
    std::env::var("SOLID_GPUI_SKIP_GUI_TESTS").is_ok()
}

fn fixture_line() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/batch-01.json");
    let raw = std::fs::read_to_string(path).expect("fixture readable");
    to_json(&from_json(&raw).expect("fixture parses"))
}

#[test]
fn window_mode_applies_batches_and_correlates_errors() {
    if skip() {
        return;
    }
    let bin = env!("CARGO_BIN_EXE_solid-gpui-helper");
    let mut child = Command::new(bin)
        .arg("--stdio-window")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("helper spawns");

    let mut stdin = child.stdin.take().expect("stdin piped");
    let reader = BufReader::new(child.stdout.take().expect("stdout piped"));
    let mut lines = reader.lines();

    // 1. The shared fixture applies fully through the real retained tree.
    writeln!(stdin, "{}", fixture_line()).unwrap();
    stdin.flush().unwrap();
    let ack = lines.next().unwrap().expect("ack line");
    assert_eq!(ack, r#"{"type":"ack","seq":42,"applied":12}"#);

    // 2. A batch that decodes but cannot apply → seq-correlated error reply.
    let bad = r#"{"v":1,"seq":7,"mutations":[{"op":"appendChild","parentId":99,"childId":1}]}"#;
    writeln!(stdin, "{bad}").unwrap();
    stdin.flush().unwrap();
    let err = lines.next().unwrap().expect("error line");
    assert!(
        err.contains(r#""type":"error""#) && err.contains(r#""seq":7"#),
        "correlated error expected, got {err}"
    );
    assert!(err.contains("applyFailed"), "code applyFailed expected: {err}");
    assert!(err.contains("parent"), "message should name the cause: {err}");

    // 3. EOF quits the app cleanly.
    drop(stdin);
    let status = child.wait().expect("wait");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}
