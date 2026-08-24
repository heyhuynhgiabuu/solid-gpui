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
    assert!(
        err.contains("applyFailed"),
        "code applyFailed expected: {err}"
    );
    assert!(
        err.contains("parent"),
        "message should name the cause: {err}"
    );

    // 3. EOF quits the app cleanly.
    drop(stdin);
    let status = child.wait().expect("wait");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}

#[test]
fn window_mode_answers_getstats_and_captureframe() {
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

    // Mount something first so at least one frame's build is recorded.
    writeln!(stdin, "{}", fixture_line()).unwrap();
    stdin.flush().unwrap();
    let ack = lines.next().unwrap().expect("ack line");
    assert!(ack.starts_with(r#"{"type":"ack""#), "{ack}");

    // getStats: a Result reply carrying the stats object.
    writeln!(stdin, r#"{{"type":"getStats","seq":5}}"#).unwrap();
    stdin.flush().unwrap();
    let reply = lines.next().unwrap().expect("result line");
    assert!(
        reply.contains(r#""type":"result""#) && reply.contains(r#""seq":5"#),
        "expected result reply, got {reply}"
    );
    assert!(
        reply.contains(r#""frames":"#) && reply.contains(r#""p95Ms":"#),
        "stats payload must include frames and p95Ms: {reply}"
    );

    // captureFrame: writes a PNG of the helper's own window to a temp path.
    let out_path = std::env::temp_dir().join(format!("solid-gpui-s7b-{}.png", std::process::id()));
    writeln!(
        stdin,
        r#"{{"type":"captureFrame","seq":6,"path":"{}"}}"#,
        out_path.display()
    )
    .unwrap();
    stdin.flush().unwrap();
    let reply = lines.next().unwrap().expect("capture result line");
    assert!(
        reply.contains(r#""type":"result""#) && reply.contains(r#""seq":6"#),
        "expected capture result reply, got {reply}"
    );
    assert!(
        reply.contains(r#""path":""#),
        "payload names the path: {reply}"
    );
    let meta = std::fs::metadata(&out_path).expect("png written");
    assert!(meta.len() > 0, "png must not be empty");
    let _ = std::fs::remove_file(&out_path);

    // EOF quits cleanly.
    drop(stdin);
    let status = child.wait().expect("wait");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}
