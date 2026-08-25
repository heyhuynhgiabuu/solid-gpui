//! `--stdio-window` end-to-end: a real GPUI window driven by stdio batches.
//! GUI-gated (needs a window server); skip headless via
//! `SOLID_GPUI_SKIP_GUI_TESTS=1`.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use solid_gpui_protocol::{from_json, to_json};

fn skip() -> bool {
    std::env::var("SOLID_GPUI_SKIP_GUI_TESTS").is_ok()
}

/// Real-window tests must not run in parallel: macOS serializes window-server
/// round trips anyway, and several windows at once push first-frame latency
/// past any reasonable poll budget (observed: intermittent both-test failures
/// under the default 4-thread test harness). Serialize them with a lock.
static WINDOW_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
    let _lock = WINDOW_TEST_LOCK.lock().unwrap();
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
    let _lock = WINDOW_TEST_LOCK.lock().unwrap();
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

#[test]
fn window_mode_mounts_scroll_container() {
    if skip() {
        return;
    }
    let _lock = WINDOW_TEST_LOCK.lock().unwrap();
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

    // A 200px scroll container holding a 2000px tall child: exercising the
    // overflow style mapping + per-element scroll handle allocation.
    let batch = concat!(
        r#"{"v":1,"seq":55,"mutations":["#,
        r#"{"op":"createElement","id":1,"elementType":"div"},"#,
        r#"{"op":"setRoot","id":1},"#,
        r#"{"op":"setStyle","id":1,"style":{"overflow":"scroll","height":200}},"#,
        r#"{"op":"createElement","id":2,"elementType":"div"},"#,
        r#"{"op":"appendChild","parentId":1,"childId":2},"#,
        r#"{"op":"setStyle","id":2,"style":{"height":2000}},"#,
        r#"{"op":"createElement","id":3,"elementType":"text"},"#,
        r#"{"op":"appendChild","parentId":2,"childId":3},"#,
        r#"{"op":"setText","id":3,"text":"tall content"}]}"#,
    );
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    let ack = lines.next().unwrap().expect("ack line");
    assert_eq!(ack, r#"{"type":"ack","seq":55,"applied":9}"#);

    // EOF quits the app cleanly.
    drop(stdin);
    let status = child.wait().expect("wait");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}

#[test]
fn window_mode_scrolls_via_commands() {
    if skip() {
        return;
    }
    let _lock = WINDOW_TEST_LOCK.lock().unwrap();
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

    // Mount the same 200px scroll container over a 2000px child.
    let batch = concat!(
        r#"{"v":1,"seq":55,"mutations":["#,
        r#"{"op":"createElement","id":1,"elementType":"div"},"#,
        r#"{"op":"setRoot","id":1},"#,
        r#"{"op":"setStyle","id":1,"style":{"overflow":"scroll","height":200}},"#,
        r#"{"op":"createElement","id":2,"elementType":"div"},"#,
        r#"{"op":"appendChild","parentId":1,"childId":2},"#,
        r#"{"op":"setStyle","id":2,"style":{"height":2000}},"#,
        r#"{"op":"createElement","id":3,"elementType":"text"},"#,
        r#"{"op":"appendChild","parentId":2,"childId":3},"#,
        r#"{"op":"setText","id":3,"text":"tall content"}]}"#,
    );
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":55,"applied":9}"#
    );

    // The window lays out asynchronously (max_offset populates in prepaint,
    // which getScrollOffset's honesty clamp reads). Under parallel window
    // tests the first frames can be delayed, so poll for the expected offset
    // instead of trusting a fixed sleep.
    fn read_offset(
        stdin: &mut std::process::ChildStdin,
        lines: &mut std::io::Lines<BufReader<std::process::ChildStdout>>,
        seq: u32,
    ) -> String {
        let line = format!(r#"{{"type":"getScrollOffset","seq":{seq},"id":1}}"#);
        writeln!(stdin, "{line}").unwrap();
        stdin.flush().unwrap();
        lines.next().unwrap().unwrap()
    }

    // scrollTo sets the retained handle's offset (positive = down)...
    let line = r#"{"type":"scrollTo","seq":61,"id":1,"x":0.0,"y":500.0}"#;
    writeln!(stdin, "{line}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"result","seq":61,"value":{"applied":true}}"#
    );

    // ...and getScrollOffset reads the actual visible position back exactly
    // (polling until layout has populated max_offset).
    let want = r#"{"type":"result","seq":62,"value":{"offsetX":0.0,"offsetY":500.0}}"#;
    let mut got = read_offset(&mut stdin, &mut lines, 62);
    for _ in 0..10 {
        if got == want {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
        got = read_offset(&mut stdin, &mut lines, 62);
    }
    assert_eq!(got, want);

    // Over-scroll clamps to the real content height (2000 - 200 viewport):
    // getScrollOffset reports what is actually shown, not the raw request.
    // Layout is known by now (the poll above succeeded), so assert directly.
    let line = r#"{"type":"scrollTo","seq":63,"id":1,"x":0.0,"y":100000.0}"#;
    writeln!(stdin, "{line}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"result","seq":63,"value":{"applied":true}}"#
    );
    assert_eq!(
        read_offset(&mut stdin, &mut lines, 64),
        r#"{"type":"result","seq":64,"value":{"offsetX":0.0,"offsetY":1800.0}}"#
    );

    // EOF quits the app cleanly.
    drop(stdin);
    let status = child.wait().expect("wait");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}

#[test]
fn window_mode_focus_events_via_focus_element() {
    if skip() {
        return;
    }
    let _lock = WINDOW_TEST_LOCK.lock().unwrap();
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

    // Root with two focusable children (tabIndex 0 + focus/blur listeners).
    let batch = concat!(
        r#"{"v":1,"seq":70,"mutations":["#,
        r#"{"op":"createElement","id":1,"elementType":"div"},"#,
        r#"{"op":"setRoot","id":1},"#,
        r#"{"op":"createElement","id":2,"elementType":"div"},"#,
        r#"{"op":"appendChild","parentId":1,"childId":2},"#,
        r#"{"op":"setStyle","id":2,"style":{"tabIndex":0}},"#,
        r#"{"op":"setEventListener","id":2,"eventType":"focus","enabled":true},"#,
        r#"{"op":"setEventListener","id":2,"eventType":"blur","enabled":true},"#,
        r#"{"op":"createElement","id":3,"elementType":"div"},"#,
        r#"{"op":"appendChild","parentId":1,"childId":3},"#,
        r#"{"op":"setStyle","id":3,"style":{"tabIndex":0}},"#,
        r#"{"op":"setEventListener","id":3,"eventType":"focus","enabled":true},"#,
        r#"{"op":"setEventListener","id":3,"eventType":"blur","enabled":true}]}"#,
    );
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":70,"applied":12}"#
    );
    // cx.on_focus_in/out subscriptions activate one frame AFTER first render
    // (gpui defers activation), so let that pass before issuing any focus —
    // otherwise the very first focus event is silently missed.
    std::thread::sleep(std::time::Duration::from_millis(150));

    // Focus element 2. gpui defers focus-event dispatch to the next frame,
    // so the reply precedes the event line: assert the reply, then wait for
    // the frame that dispatches the focus event.
    let line = r#"{"type":"focusElement","seq":71,"id":2}"#;
    writeln!(stdin, "{line}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"result","seq":71,"value":{"applied":true}}"#
    );
    std::thread::sleep(std::time::Duration::from_millis(150));
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"event","id":2,"eventType":"focus"}"#
    );

    // Move focus to 3: element 2 blurs, element 3 focuses (order-free).
    let line = r#"{"type":"focusElement","seq":72,"id":3}"#;
    writeln!(stdin, "{line}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"result","seq":72,"value":{"applied":true}}"#
    );
    std::thread::sleep(std::time::Duration::from_millis(150));
    let mut pair = [
        lines.next().unwrap().unwrap(),
        lines.next().unwrap().unwrap(),
    ];
    pair.sort();
    assert_eq!(
        pair,
        [
            r#"{"type":"event","id":2,"eventType":"blur"}"#.to_string(),
            r#"{"type":"event","id":3,"eventType":"focus"}"#.to_string(),
        ]
    );

    // EOF quits the app cleanly.
    drop(stdin);
    let status = child.wait().expect("wait");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}

#[test]
fn window_mode_autofocus_fires_without_focus_element() {
    if skip() {
        return;
    }
    let _lock = WINDOW_TEST_LOCK.lock().unwrap();
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

    // One focusable child whose style declares autoFocus: mounting alone must
    // focus it (HTML semantics), no focusElement command needed.
    let batch = concat!(
        r#"{"v":1,"seq":80,"mutations":["#,
        r#"{"op":"createElement","id":1,"elementType":"div"},"#,
        r#"{"op":"setRoot","id":1},"#,
        r#"{"op":"createElement","id":2,"elementType":"div"},"#,
        r#"{"op":"appendChild","parentId":1,"childId":2},"#,
        r#"{"op":"setStyle","id":2,"style":{"autoFocus":"true","tabIndex":-1}},"#,
        r#"{"op":"setEventListener","id":2,"eventType":"focus","enabled":true}]}"#,
    );
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":80,"applied":6}"#
    );

    // The focus event fires on the next frame (subscriptions activate one
    // frame after first render, then autoFocus focuses during that apply).
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"event","id":2,"eventType":"focus"}"#
    );

    // EOF quits the app cleanly.
    drop(stdin);
    let status = child.wait().expect("wait");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}

#[test]
fn window_mode_input_change_events_and_controlled_sync() {
    if skip() {
        return;
    }
    let _lock = WINDOW_TEST_LOCK.lock().unwrap();
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

    // Root with an empty input and a prefilled textarea, both with change
    // listeners. setValue (JS→helper controlled value) initializes the state.
    let batch = concat!(
        r#"{"v":1,"seq":90,"mutations":["#,
        r#"{"op":"createElement","id":1,"elementType":"div"},"#,
        r#"{"op":"setRoot","id":1},"#,
        r#"{"op":"createElement","id":2,"elementType":"input"},"#,
        r#"{"op":"appendChild","parentId":1,"childId":2},"#,
        r#"{"op":"setValue","id":2,"value":""},"#,
        r#"{"op":"setEventListener","id":2,"eventType":"change","enabled":true},"#,
        r#"{"op":"createElement","id":3,"elementType":"textarea"},"#,
        r#"{"op":"appendChild","parentId":1,"childId":3},"#,
        r#"{"op":"setValue","id":3,"value":"hi"},"#,
        r#"{"op":"setEventListener","id":3,"eventType":"change","enabled":true}]}"#,
    );
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":90,"applied":10}"#
    );
    // First render + focus-subscription activation frame.
    std::thread::sleep(std::time::Duration::from_millis(200));

    // simulateInput types at the caret through the SAME path as the platform
    // IME (edit_input): the change event (helper→JS) precedes the result reply
    // because the sink writes inside window.update.
    let line = r#"{"type":"simulateInput","seq":91,"id":2,"text":"ab"}"#;
    writeln!(stdin, "{line}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"event","id":2,"eventType":"change","value":"ab"}"#
    );
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"result","seq":91,"value":{"applied":true}}"#
    );

    // Controlled sync back: JS echoes "XY" via setValue, overwriting the
    // internal "ab" and resetting the caret to the end.
    let batch = r#"{"v":1,"seq":92,"mutations":[{"op":"setValue","id":2,"value":"XY"}]}"#;
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":92,"applied":1}"#
    );
    // A further edit appends at the new caret: "XYc".
    let line = r#"{"type":"simulateInput","seq":93,"id":2,"text":"c"}"#;
    writeln!(stdin, "{line}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"event","id":2,"eventType":"change","value":"XYc"}"#
    );

    // EOF quits the app cleanly.
    drop(stdin);
    let status = child.wait().expect("wait");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}

#[test]
fn window_mode_virtual_list_follows_tail_and_virtualizes() {
    if skip() {
        return;
    }
    let _lock = WINDOW_TEST_LOCK.lock().unwrap();
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

    /// One item = a div appended to the list (identity by index, v1).
    fn item_mutations(first: u32, count: u32) -> String {
        // Items carry an explicit height: gpui's List measures the REAL item
        // height (0-height items would render forever while the visible
        // region never fills — the walk keeps going past the end).
        let mut out = String::new();
        for i in first..first + count {
            out.push_str(&format!(
                r#"{{"op":"createElement","id":{i},"elementType":"div"}},{{"op":"appendChild","parentId":1,"childId":{i}}},{{"op":"setStyle","id":{i},"style":{{"height":24}}}},"#
            ));
        }
        out
    }

    // A followTail list: itemHeight 24 (uniform hint), 500 items. The whole
    // retained tree holds every item; gpui's List paints only the visible
    // subset (window is 360px tall → ~15 visible at 24px).
    let batch = format!(
        concat!(
            r#"{{"v":1,"seq":100,"mutations":[{{"op":"createElement","id":1,"elementType":"list"}},"#,
            r#"{{"op":"setRoot","id":1}},"#,
            r#"{{"op":"setStyle","id":1,"style":{{"followTail":"true","itemHeight":24}}}},"#,
            "{}",
            r#"]}}"#,
        ),
        item_mutations(2, 500).trim_end_matches(',')
    );
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":100,"applied":1503}"#
    );
    // First paint + followTail initial scroll.
    std::thread::sleep(std::time::Duration::from_millis(400));

    fn list_info(
        stdin: &mut std::process::ChildStdin,
        lines: &mut std::io::Lines<BufReader<std::process::ChildStdout>>,
        seq: u32,
    ) -> serde_json::Value {
        writeln!(stdin, r#"{{"type":"listInfo","seq":{seq},"id":1}}"#).unwrap();
        stdin.flush().unwrap();
        let reply = lines.next().unwrap().unwrap();
        let parsed: serde_json::Value =
            serde_json::from_str(&reply).expect("listInfo reply parses");
        assert_eq!(parsed["type"], "result", "{reply}");
        assert_eq!(parsed["seq"], seq, "{reply}");
        parsed["value"].clone()
    }

    // Auto-followed to the end (chat), virtualized: 500 retained items, far
    // fewer painted.
    let info = list_info(&mut stdin, &mut lines, 101);
    assert_eq!(info["itemCount"], 500, "{info}");
    assert_eq!(info["atEnd"], true, "{info}");
    let painted = info["paintedCount"].as_u64().unwrap();
    assert!(
        painted > 0 && painted < 200,
        "virtualized paint expected, got {painted}"
    );

    // Append 100 items: followTail re-engages, still at the end.
    let batch = format!(
        r#"{{"v":1,"seq":102,"mutations":[{}]}}"#,
        item_mutations(502, 100).trim_end_matches(',')
    );
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":102,"applied":300}"#
    );
    std::thread::sleep(std::time::Duration::from_millis(300));
    let info = list_info(&mut stdin, &mut lines, 103);
    assert_eq!(info["itemCount"], 600, "{info}");
    assert_eq!(info["atEnd"], true, "{info}");

    // Remove 100 items: count reconciles.
    let mut removes = String::new();
    for i in 502..602 {
        removes.push_str(&format!(
            r#"{{"op":"removeChild","parentId":1,"childId":{i}}},"#
        ));
    }
    let batch = format!(
        r#"{{"v":1,"seq":104,"mutations":[{}]}}"#,
        removes.trim_end_matches(',')
    );
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":104,"applied":100}"#
    );
    std::thread::sleep(std::time::Duration::from_millis(300));
    let info = list_info(&mut stdin, &mut lines, 105);
    assert_eq!(info["itemCount"], 500, "{info}");
    assert_eq!(info["atEnd"], true, "{info}");

    // S11b: a content change inside an item (setStyle height 24 -> 60) marks
    // it for remeasure; the list survives, counts stay, follow re-engages.
    let batch =
        r#"{"v":1,"seq":106,"mutations":[{"op":"setStyle","id":502,"style":{"height":60}}]}"#;
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":106,"applied":1}"#
    );
    std::thread::sleep(std::time::Duration::from_millis(300));
    let info = list_info(&mut stdin, &mut lines, 107);
    assert_eq!(info["itemCount"], 500, "{info}");
    assert_eq!(info["atEnd"], true, "{info}");
    let painted = info["paintedCount"].as_u64().unwrap();
    assert!(
        painted > 0 && painted < 200,
        "virtualized paint expected, got {painted}"
    );

    // EOF quits the app cleanly.
    drop(stdin);
    let status = child.wait().expect("wait");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}

#[test]
fn window_mode_follow_tail_toggle_keeps_items() {
    if skip() {
        return;
    }
    let _lock = WINDOW_TEST_LOCK.lock().unwrap();
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

    // A Top-aligned list (no followTail) with 100 items. Small lists report
    // atEnd null (gpui: not yet scrollable / heights not all known), so keep
    // it clearly larger than the viewport: false at the top, true once
    // following.
    let mut items = String::new();
    for i in 2..102 {
        items.push_str(&format!(
            r#"{{"op":"createElement","id":{i},"elementType":"div"}},{{"op":"appendChild","parentId":1,"childId":{i}}},{{"op":"setStyle","id":{i},"style":{{"height":24}}}},"#
        ));
    }
    let batch = format!(
        concat!(
            r#"{{"v":1,"seq":110,"mutations":[{{"op":"createElement","id":1,"elementType":"list"}},"#,
            r#"{{"op":"setRoot","id":1}},"#,
            r#"{{"op":"setStyle","id":1,"style":{{"itemHeight":24}}}},"#,
            "{}",
            r#"]}}"#,
        ),
        items.trim_end_matches(',')
    );
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":110,"applied":303}"#
    );
    std::thread::sleep(std::time::Duration::from_millis(400));

    let info = r#"{"type":"listInfo","seq":111,"id":1}"#;
    writeln!(stdin, "{info}").unwrap();
    stdin.flush().unwrap();
    let reply: serde_json::Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
    assert_eq!(reply["value"]["itemCount"], 100, "{reply}");
    assert_eq!(reply["value"]["atEnd"], false, "{reply}");

    // Toggle followTail: the state is RECREATED (Bottom alignment + Tail
    // follow). The recreated 0-item state must be spliced to the retained
    // children on the next render — a stale splice baseline would leave the
    // list empty until the next children mutation (review regression).
    let batch = r#"{"v":1,"seq":112,"mutations":[{"op":"setStyle","id":1,"style":{"followTail":"true","itemHeight":24}}]}"#;
    writeln!(stdin, "{batch}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":112,"applied":1}"#
    );
    std::thread::sleep(std::time::Duration::from_millis(400));

    // The recreated state must hold the retained items (the reviewer's
    // regression: a stale splice baseline left the recreated state at 0
    // items until the next children mutation). atEnd is NOT asserted after
    // the toggle: gpui reports null while the fresh state's heights are
    // still unknown — the follow itself works (layout recomputes the end
    // position every frame while following).
    let info = r#"{"type":"listInfo","seq":113,"id":1}"#;
    writeln!(stdin, "{info}").unwrap();
    stdin.flush().unwrap();
    let reply: serde_json::Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
    assert_eq!(reply["value"]["itemCount"], 100, "{reply}");
    let painted = reply["value"]["paintedCount"].as_u64().unwrap();
    assert!(
        painted > 0 && painted < 200,
        "virtualized paint expected, got {painted}"
    );

    // EOF quits the app cleanly.
    drop(stdin);
    let status = child.wait().expect("wait");
    assert_eq!(status.code(), Some(0), "EOF must exit 0");
}

/// setAnimation must drive continuous frames while the transition runs and
/// settle (no idle frame churn) once complete. Observable via getStats
/// frame counts — no pixel capture needed.
#[test]
fn window_mode_animation_frames_flow_and_settle() {
    if skip() {
        return;
    }
    let _lock = WINDOW_TEST_LOCK.lock().unwrap();
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

    let mount = r#"{"v":1,"seq":120,"mutations":[{"op":"createElement","id":1,"elementType":"div"},{"op":"setRoot","id":1},{"op":"setStyle","id":1,"style":{"height":40,"opacity":1,"width":200}}]}"#;
    writeln!(stdin, "{mount}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":120,"applied":3}"#
    );

    fn stats(
        seq: u32,
        stdin: &mut std::process::ChildStdin,
        lines: &mut dyn Iterator<Item = std::io::Result<String>>,
    ) -> serde_json::Value {
        writeln!(stdin, r#"{{"type":"getStats","seq":{seq}}}"#).unwrap();
        stdin.flush().unwrap();
        serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap()
    }

    // Let the mount frame land, then snapshot the frame count.
    std::thread::sleep(std::time::Duration::from_millis(300));
    let before = stats(121, &mut stdin, &mut lines);
    let frames0 = before["value"]["frames"].as_u64().expect("frames");

    // 400ms linear transition: while running, each render requests the next
    // frame, so the count must climb well past the mount baseline.
    let anim = r#"{"v":1,"seq":122,"mutations":[{"op":"setAnimation","id":1,"target":{"opacity":0.5,"width":300},"transitionMs":400,"easing":"linear"}]}"#;
    writeln!(stdin, "{anim}").unwrap();
    stdin.flush().unwrap();
    assert_eq!(
        lines.next().unwrap().unwrap(),
        r#"{"type":"ack","seq":122,"applied":1}"#
    );
    std::thread::sleep(std::time::Duration::from_millis(150));
    let mid = stats(123, &mut stdin, &mut lines);
    let frames1 = mid["value"]["frames"].as_u64().expect("frames");
    assert!(
        frames1 >= frames0 + 3,
        "animation must drive frames: {frames0} -> {frames1}"
    );

    // Past the transition end the frame source stops: two snapshots 300ms
    // apart must agree (±1 for a stray system frame).
    std::thread::sleep(std::time::Duration::from_millis(500));
    let done = stats(124, &mut stdin, &mut lines);
    let frames2 = done["value"]["frames"].as_u64().expect("frames");
    std::thread::sleep(std::time::Duration::from_millis(300));
    let settled = stats(125, &mut stdin, &mut lines);
    let frames3 = settled["value"]["frames"].as_u64().expect("frames");
    assert!(
        frames3 <= frames2 + 1,
        "animation must settle: {frames2} -> {frames3}"
    );

    drop(stdin);
    child.wait().ok();
}
