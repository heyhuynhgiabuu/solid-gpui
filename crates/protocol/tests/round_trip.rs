use solid_gpui_protocol::{
    ApplyError, Command, ElementId, Event, EventType, Mutation, MutationBatch, MutationHandler,
    ProtocolError, Reply, ReplyCode, command_from_json, command_to_json, event_from_json,
    event_to_json, from_json, reply_from_json, reply_to_json, to_json,
};
use std::fs;

fn fixture() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/batch-01.json");
    fs::read_to_string(path).expect("fixture readable")
}

struct Recording {
    ops: Vec<Mutation>,
}

impl MutationHandler for Recording {
    fn apply(&mut self, mutation: &Mutation) -> Result<(), ApplyError> {
        self.ops.push(mutation.clone());
        Ok(())
    }
}

#[test]
fn fixture_parses_and_round_trips() {
    let json = fixture();
    let batch = from_json(&json).expect("fixture parses");
    assert_eq!(batch.v, 1);
    assert_eq!(batch.seq, 42);
    assert_eq!(batch.mutations.len(), 12);
    assert!(matches!(batch.mutations[3], Mutation::SetRoot { .. }));
    match &batch.mutations[8] {
        Mutation::SetText { text, .. } => assert_eq!(text, "Xin chào solid-gpui 🎉"),
        other => panic!("expected SetText at index 8, got {other:?}"),
    }
    let re = from_json(&to_json(&batch)).expect("re-parse of emitted JSON");
    assert_eq!(batch, re);
}

#[test]
fn handler_receives_every_mutation_in_order() {
    let batch: MutationBatch = from_json(&fixture()).expect("fixture parses");
    let mut rec = Recording { ops: Vec::new() };
    for m in &batch.mutations {
        rec.apply(m).expect("recorder never fails");
    }
    assert_eq!(rec.ops, batch.mutations);
}

fn emitted_snapshot_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/rust-emitted-batch-01.json")
}

/// Slice 2 contract: the committed snapshot must be byte-identical to what
/// Rust `to_json` emits for the shared fixture. Regenerate with
/// `cargo test -p solid-gpui-protocol regenerate_rust_emission -- --ignored`
/// and commit the result — bun tests parse the same file.
#[test]
fn rust_emission_matches_committed_snapshot() {
    let batch = from_json(&fixture()).expect("fixture parses");
    let emitted = to_json(&batch);
    let snapshot = std::fs::read_to_string(emitted_snapshot_path())
        .expect("snapshot missing — regenerate it (see this test's doc comment)");
    assert_eq!(emitted, snapshot.trim_end());
}

#[test]
#[ignore = "generator: run explicitly to (re)write the committed snapshot"]
fn regenerate_rust_emission() {
    let batch = from_json(&fixture()).expect("fixture parses");
    std::fs::write(emitted_snapshot_path(), format!("{}\n", to_json(&batch)))
        .expect("snapshot writable");
}

#[test]
fn reply_fixture_parses_and_emits_exactly() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/reply-01.json");
    let raw = fs::read_to_string(path).expect("fixture readable");
    let reply = reply_from_json(raw.trim()).expect("reply parses");
    assert_eq!(
        reply,
        Reply::Ack {
            seq: 42,
            applied: 12
        }
    );
    assert_eq!(
        reply_to_json(&Reply::Ack {
            seq: 42,
            applied: 12
        }),
        raw.trim()
    );
}

#[test]
fn error_reply_round_trips() {
    let reply = Reply::Error {
        seq: None,
        code: ReplyCode::DecodeFailed,
        message: "unknown mutation op `teleport`".into(),
    };
    let json = reply_to_json(&reply);
    assert_eq!(reply_from_json(&json).unwrap(), reply);
    assert!(json.contains(r#""code":"decodeFailed""#));
}

#[test]
fn event_fixture_parses_and_emits_exactly() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/event-01.json");
    let raw = fs::read_to_string(path)
        .expect("fixture readable")
        .trim()
        .to_string();
    let event = event_from_json(&raw).expect("event parses");
    assert_eq!(
        event,
        Event::Click {
            id: 3.into(),
            event_type: EventType::Click,
            x: Some(12.5),
            y: Some(40.0),
        }
    );
    assert_eq!(event_to_json(&event), raw);
}

#[test]
fn click_event_without_position_omits_nulls_on_wire() {
    let json = event_to_json(&Event::Click {
        id: 9.into(),
        event_type: EventType::Click,
        x: None,
        y: None,
    });
    assert!(
        !json.contains("null"),
        "None positions must be omitted: {json}"
    );
    assert_eq!(
        event_from_json(&json).unwrap(),
        Event::Click {
            id: 9.into(),
            event_type: EventType::Click,
            x: None,
            y: None,
        }
    );
}

#[test]
fn get_stats_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-get-stats.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(cmd, Command::GetStats { seq: 7 });
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn capture_frame_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-capture-frame.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(
        cmd,
        Command::CaptureFrame {
            seq: 8,
            path: "/tmp/shot.png".into()
        }
    );
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn scroll_to_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-scroll-to.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(
        cmd,
        Command::ScrollTo {
            seq: 9,
            id: ElementId(1),
            x: 0.0,
            y: 500.0,
        }
    );
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn get_scroll_offset_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-get-scroll-offset.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(
        cmd,
        Command::GetScrollOffset {
            seq: 10,
            id: ElementId(1),
        }
    );
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn result_reply_fixture_parses_with_payload() {
    let raw = fs::read_to_string(fixture_path("result-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let reply = reply_from_json(&raw).expect("reply parses");
    match reply {
        Reply::Result { seq, value } => {
            assert_eq!(seq, 7);
            assert_eq!(value["frames"], 34);
            assert_eq!(value["p95Ms"], 0.1);
        }
        other => panic!("expected Result reply, got {other:?}"),
    }
}

#[test]
fn unknown_command_name_is_invalid_shape_not_invalid_json() {
    let err = command_from_json(r#"{"type":"teleport","seq":1}"#).expect_err("must not parse");
    assert!(matches!(err, ProtocolError::InvalidShape { .. }), "{err:?}");
}

fn fixture_path(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures")
        .join(name)
}

#[test]
fn rejects_unsupported_version() {
    let err = from_json(r#"{"v":2,"seq":0,"mutations":[]}"#).unwrap_err();
    assert_eq!(
        err,
        ProtocolError::UnsupportedVersion { got: 2 },
        "got: {err}"
    );
}

#[test]
fn oversized_version_is_reported_without_truncation() {
    // 2^32 + 2 used to truncate to 2 via `as u32`.
    let err = from_json(r#"{"v":4294967298,"seq":0,"mutations":[]}"#).unwrap_err();
    assert_eq!(err, ProtocolError::UnsupportedVersion { got: 4294967298 });
}

#[test]
fn zero_id_error_path_names_the_actual_field() {
    let err =
        from_json(r#"{"v":1,"seq":0,"mutations":[{"op":"appendChild","parentId":1,"childId":0}]}"#)
            .unwrap_err();
    match err {
        ProtocolError::InvalidShape { path, .. } => {
            assert_eq!(path, "mutations[0].childId")
        }
        other => panic!("expected InvalidShape, got {other:?}"),
    }
}

#[test]
fn rejects_unknown_op() {
    let err = from_json(r#"{"v":1,"seq":0,"mutations":[{"op":"teleport","id":1}]}"#).unwrap_err();
    assert_eq!(
        err,
        ProtocolError::UnknownOp {
            got: "teleport".into()
        }
    );
}

#[test]
fn rejects_unknown_event_type() {
    let err = from_json(
        r#"{"v":1,"seq":0,"mutations":[{"op":"setEventListener","id":1,"eventType":"tap","enabled":true}]}"#,
    )
    .unwrap_err();
    assert_eq!(err, ProtocolError::UnknownEventType { got: "tap".into() });
}

#[test]
fn rejects_unknown_element_type() {
    let err = from_json(
        r#"{"v":1,"seq":0,"mutations":[{"op":"createElement","id":1,"elementType":"canvas"}]}"#,
    )
    .unwrap_err();
    assert_eq!(
        err,
        ProtocolError::UnknownElementType {
            got: "canvas".into()
        }
    );
}

#[test]
fn rejects_zero_id() {
    let err = from_json(r#"{"v":1,"seq":0,"mutations":[{"op":"setRoot","id":0}]}"#).unwrap_err();
    assert!(
        matches!(err, ProtocolError::InvalidShape { .. }),
        "got: {err}"
    );
}

#[test]
fn rejects_non_integer_id() {
    let err = from_json(r#"{"v":1,"seq":0,"mutations":[{"op":"setRoot","id":1.5}]}"#).unwrap_err();
    assert!(
        matches!(err, ProtocolError::InvalidShape { .. }),
        "got: {err}"
    );
}
