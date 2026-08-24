//! `--stdio` transport contract: the helper reads NDJSON mutation batches from
//! stdin and replies with one NDJSON line per batch — ack or error. Closing
//! stdin ends the process with exit 0. No GUI is involved (transport layer).

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use solid_gpui_protocol::{from_json, to_json};

fn skip() -> bool {
    std::env::var("SOLID_GPUI_SKIP_GUI_TESTS").is_ok()
}

#[test]
fn stdio_round_trip_ack_and_error() {
    if skip() {
        return;
    }
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

    // 3. A valid command in transport mode answers Unsupported (no window),
    //    correlated by the command's own seq.
    writeln!(stdin, r#"{{"type":"getStats","seq":9}}"#).unwrap();
    stdin.flush().unwrap();
    let mut line = String::new();
    reader.read_line(&mut line).expect("read unsupported reply");
    let trimmed = line.trim();
    assert!(
        trimmed.starts_with(r#"{"type":"error","seq":9,"code":"unsupported""#),
        "expected unsupported error for getStats in transport mode, got {trimmed}"
    );

    // 4. EOF on stdin ends the process cleanly.
    drop(stdin);
    let status = child.wait().expect("wait for exit");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}
