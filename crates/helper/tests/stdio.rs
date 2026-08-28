//! `--stdio` transport contract: the helper reads NDJSON mutation batches from
//! stdin and replies with one NDJSON line per batch — ack or error. Closing
//! stdin ends the process with exit 0. No GUI is involved (transport layer),
//! so these tests intentionally run even when real-window tests are skipped.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use solid_gpui_protocol::{from_json, to_json};

#[test]
fn stdio_round_trip_ack_and_error() {
    let bin = env!("CARGO_BIN_EXE_solid-gpui-helper");
    let mut child = Command::new(bin)
        .arg("--stdio")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("helper spawns in --stdio mode");

    let mut stdin = child.stdin.take().expect("stdin piped");
    let stdout = child.stdout.take().expect("stdout piped");
    let mut reader = BufReader::new(stdout);

    // 1. A valid batch (the shared fixture, compacted losslessly via the
    //    protocol's own encoder — a naive whitespace strip would corrupt the
    //    UTF-8 string contents) must be acked with seq + count.
    let fixture_raw = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/protocol/fixtures/batch-01.json"),
    )
    .expect("fixture readable");
    let fixture = to_json(&from_json(&fixture_raw).expect("fixture parses"));
    writeln!(stdin, "{fixture}").expect("write batch line");
    stdin.flush().expect("flush");

    let mut line = String::new();
    reader.read_line(&mut line).expect("read ack");
    assert_eq!(
        line.trim(),
        r#"{"type":"ack","seq":42,"applied":12}"#,
        "ack must echo seq and mutation count"
    );

    // 2. A malformed batch must produce an error reply, not a crash or silence.
    writeln!(
        stdin,
        "{{\"v\":1,\"seq\":7,\"mutations\":[{{\"op\":\"teleport\"}}]}}"
    )
    .unwrap();
    stdin.flush().unwrap();
    let mut line = String::new();
    reader.read_line(&mut line).expect("read error reply");
    let trimmed = line.trim();
    assert!(
        trimmed.starts_with(r#"{"type":"error""#),
        "expected error reply, got {trimmed}"
    );
    assert!(
        trimmed.contains("teleport"),
        "error must name the unknown op"
    );

    // 3. Gate 5-a: transport-mode getStats answers a VERSION-ONLY payload
    //    (headless launchers verify versions without a window), correlated
    //    by the command's own seq; every other command stays Unsupported.
    writeln!(stdin, r#"{{"type":"getStats","seq":9}}"#).unwrap();
    stdin.flush().unwrap();
    let mut line = String::new();
    reader.read_line(&mut line).expect("read getStats reply");
    let trimmed = line.trim();
    assert!(
        trimmed.starts_with(r#"{"type":"result","seq":9,"value":"#)
            && trimmed.contains(r#""helperVersion""#)
            && trimmed.contains(r#""protocolVersion":1"#)
            && trimmed.contains(r#""frames":null"#),
        "expected version-only getStats payload in transport mode, got {trimmed}"
    );

    // 4. A window-requiring command still answers Unsupported (no window).
    writeln!(stdin, r#"{{"type":"setTitle","seq":10,"title":"x"}}"#).unwrap();
    stdin.flush().unwrap();
    let mut line = String::new();
    reader.read_line(&mut line).expect("read unsupported reply");
    let trimmed = line.trim();
    assert!(
        trimmed.starts_with(r#"{"type":"error","seq":10,"code":"unsupported""#),
        "expected unsupported error for setTitle in transport mode, got {trimmed}"
    );

    // 4. EOF on stdin ends the process cleanly.
    drop(stdin);
    let status = child.wait().expect("wait for exit");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}

/// Wire-safety probe: every malformed/unknown/version-mismatched input must
/// produce a structured decodeFailed error reply (seq null — an untrusted
/// line carries no usable seq) and NEVER kill the helper. Each failure phase
/// is followed by a valid batch ack to prove the process stays alive, then
/// EOF exits 0.
#[test]
fn stdio_rejects_malformed_input_but_stays_alive() {
    let bin = env!("CARGO_BIN_EXE_solid-gpui-helper");
    let mut child = Command::new(bin)
        .arg("--stdio")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("helper spawns in --stdio mode");

    let mut stdin = child.stdin.take().expect("stdin piped");
    let stdout = child.stdout.take().expect("stdout piped");
    let mut reader = BufReader::new(stdout);

    let fixture_raw = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/protocol/fixtures/batch-01.json"),
    )
    .expect("fixture readable");
    let fixture = to_json(&from_json(&fixture_raw).expect("fixture parses"));

    // Each phase: send a malformed line, expect a seq-null decodeFailed error
    // naming the cause, then send a valid batch and expect its ack — the
    // helper survived the garbage and processed the next line.
    let phases: Vec<(&str, &str)> = vec![
        // Invalid JSON: the reader itself must not crash.
        ("{not json", "invalid JSON"),
        // Wrong protocol version.
        (r#"{"v":2,"seq":3,"mutations":[]}"#, "version"),
        // Missing protocol version field.
        (r#"{"seq":3,"mutations":[]}"#, "missing field"),
        // Unknown mutation op.
        (
            r#"{"v":1,"seq":3,"mutations":[{"op":"teleport","id":1}]}"#,
            "teleport",
        ),
        // Unknown element type.
        (
            r#"{"v":1,"seq":3,"mutations":[{"op":"createElement","id":1,"elementType":"vaporwave"}]}"#,
            "element type",
        ),
        // Unknown event type.
        (
            r#"{"v":1,"seq":3,"mutations":[{"op":"setEventListener","id":1,"eventType":"hover","enabled":true}]}"#,
            "event type",
        ),
        // Zero is never a valid element id.
        (
            r#"{"v":1,"seq":3,"mutations":[{"op":"createElement","id":0,"elementType":"div"}]}"#,
            "element ids",
        ),
    ];
    for (bad_line, expected) in phases {
        writeln!(stdin, "{bad_line}").expect("write bad line");
        stdin.flush().expect("flush");
        let mut line = String::new();
        reader.read_line(&mut line).expect("read error reply");
        let trimmed = line.trim();
        assert!(
            trimmed.starts_with(r#"{"type":"error","seq":null,"code":"decodeFailed""#),
            "expected seq-null decodeFailed, got {trimmed}"
        );
        assert!(
            trimmed.contains(expected),
            "error must name the cause ({expected:?}), got {trimmed}"
        );

        // Process still alive: the next valid line is acked normally.
        writeln!(stdin, "{fixture}").expect("write valid batch");
        stdin.flush().expect("flush");
        let mut line = String::new();
        reader.read_line(&mut line).expect("read ack");
        assert_eq!(
            line.trim(),
            r#"{"type":"ack","seq":42,"applied":12}"#,
            "helper must survive a malformed line"
        );
    }

    // EOF on stdin ends the process cleanly.
    drop(stdin);
    let status = child.wait().expect("wait for exit");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}
