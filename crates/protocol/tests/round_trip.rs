use solid_gpui_protocol::{
    AccessibilityRole, ApplyError, Command, DrawItem, ElementId, ElementType, Event, EventType,
    Mutation, MutationBatch, MutationHandler, ProtocolError, Reply, ReplyCode, RetainedTree,
    command_from_json, command_to_json, event_from_json, event_to_json, from_json, reply_from_json,
    reply_to_json, to_json,
};
use std::fs;

fn fixture() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/batch-01.json");
    fs::read_to_string(path).expect("fixture readable")
}

fn text_runs_fixture() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/batch-text-runs-01.json");
    fs::read_to_string(path).expect("text-runs fixture readable")
}

fn tooltip_fixture() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/batch-tooltip-01.json");
    fs::read_to_string(path).expect("tooltip fixture readable")
}

fn accessibility_fixture() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/batch-accessibility-01.json");
    fs::read_to_string(path).expect("accessibility fixture readable")
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
fn text_runs_fixture_parses_and_round_trips() {
    let json = text_runs_fixture();
    let batch = from_json(&json).expect("text-runs fixture parses");
    let emitted = to_json(&batch);
    let re = from_json(&emitted).expect("re-parse of emitted text-runs JSON");
    assert_eq!(batch, re);
    assert_eq!(
        emitted,
        json.trim_end(),
        "fixture must use Rust's canonical JSON"
    );
}

#[test]
fn tooltip_fixture_parses_and_round_trips() {
    let json = tooltip_fixture();
    let batch = from_json(&json).expect("tooltip fixture parses");
    assert!(matches!(
        &batch.mutations[1],
        Mutation::SetTooltip {
            tooltip: Some(text),
            ..
        } if text == "Save this item"
    ));
    let emitted = to_json(&batch);
    assert_eq!(
        emitted,
        json.trim_end(),
        "fixture must use Rust's canonical JSON"
    );

    let mut tree = RetainedTree::new();
    for mutation in &batch.mutations {
        tree.apply(mutation).expect("tooltip fixture applies");
    }
    assert_eq!(
        tree.get(ElementId(1))
            .and_then(|node| node.tooltip.as_deref()),
        Some("Save this item")
    );
    tree.apply(&Mutation::SetTooltip {
        id: ElementId(1),
        tooltip: None,
    })
    .expect("null clears tooltip");
    assert_eq!(
        tree.get(ElementId(1))
            .and_then(|node| node.tooltip.as_deref()),
        None
    );
}

#[test]
fn input_listener_event_type_is_accepted() {
    let batch = from_json(
        r#"{"v":1,"seq":1,"mutations":[{"op":"createElement","id":1,"elementType":"input"},{"op":"setEventListener","id":1,"eventType":"input","enabled":true}]}"#,
    )
    .expect("input listener event type is part of the closed set");
    assert!(matches!(
        batch.mutations[1],
        Mutation::SetEventListener {
            event_type: EventType::Input,
            enabled: true,
            ..
        }
    ));
}

#[test]
fn accessibility_fixture_parses_and_round_trips() {
    let json = accessibility_fixture();
    let batch = from_json(&json).expect("accessibility fixture parses");
    assert_eq!(batch.seq, 70);
    assert!(matches!(
        &batch.mutations[1],
        Mutation::SetAccessibility { accessibility: Some(state), .. }
            if state.role == AccessibilityRole::ComboBox
                && state.expanded == Some(true)
                && state.value.as_deref() == Some("red")
    ));
    assert_eq!(to_json(&batch), json.trim_end());
    let mut tree = RetainedTree::new();
    for mutation in &batch.mutations {
        tree.apply(mutation).expect("accessibility fixture applies");
    }
    assert_eq!(tree.root(), Some(ElementId(1)));
}

#[test]
fn accessibility_decoder_rejects_missing_and_malformed_states() {
    for raw in [
        r#"{"v":1,"seq":1,"mutations":[{"op":"setAccessibility","id":1}]}"#,
        r#"{"v":1,"seq":1,"mutations":[{"op":"setAccessibility","id":1,"accessibility":{"role":"slider"}}]}"#,
        r#"{"v":1,"seq":1,"mutations":[{"op":"setAccessibility","id":1,"accessibility":{"role":"option","selected":"yes"}}]}"#,
        r#"{"v":1,"seq":1,"mutations":[{"op":"setAccessibility","id":1,"accessibility":{"role":"option","selected":null}}]}"#,
        r#"{"v":1,"seq":1,"mutations":[{"op":"setAccessibility","id":1,"accessibility":{"role":"combobox","expanded":null}}]}"#,
    ] {
        assert!(
            from_json(raw).is_err(),
            "malformed accessibility accepted: {raw}"
        );
    }
}

#[test]
fn tooltip_decoder_rejects_empty_text() {
    let error =
        from_json(r#"{"v":1,"seq":1,"mutations":[{"op":"setTooltip","id":1,"tooltip":""}]}"#)
            .expect_err("empty tooltip must be rejected");
    assert!(matches!(
        error,
        ProtocolError::InvalidShape { ref path, .. } if path.contains("tooltip")
    ));
}

#[test]
fn tooltip_decoder_rejects_missing_text() {
    let error = from_json(r#"{"v":1,"seq":1,"mutations":[{"op":"setTooltip","id":1}]}"#)
        .expect_err("missing tooltip must be rejected");
    assert!(matches!(
        error,
        ProtocolError::InvalidShape { ref path, .. } if path.contains("tooltip")
    ));
}

#[test]
fn text_runs_decoder_rejects_invalid_segments() {
    for (field, value) in [("text", "\"\""), ("weight", "99")] {
        let json = format!(
            r#"{{"v":1,"seq":1,"mutations":[{{"op":"setTextRuns","id":1,"runs":[{{"text":"ok","{field}":{value}}}]}}]}}"#
        );
        let error = from_json(&json).expect_err("invalid text run must be rejected");
        assert!(
            matches!(error, ProtocolError::InvalidShape { ref path, .. } if path.contains(field)),
            "{error:?}"
        );
    }
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
        Event::Input {
            id: 3.into(),
            event_type: EventType::Click,
            x: Some(12.5),
            y: Some(40.0),
            key: None,
            modifiers: None,
            value: None,
        }
    );
    assert_eq!(event_to_json(&event), raw);
}

#[test]
fn click_event_without_position_omits_nulls_on_wire() {
    let json = event_to_json(&Event::Input {
        id: 9.into(),
        event_type: EventType::Click,
        x: None,
        y: None,
        key: None,
        modifiers: None,
        value: None,
    });
    assert!(
        !json.contains("null"),
        "None positions must be omitted: {json}"
    );
    assert_eq!(
        event_from_json(&json).unwrap(),
        Event::Input {
            id: 9.into(),
            event_type: EventType::Click,
            x: None,
            y: None,
            key: None,
            modifiers: None,
            value: None,
        }
    );
}

#[test]
fn key_down_event_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("event-keydown-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let event = event_from_json(&raw).expect("event parses");
    match &event {
        Event::Menu { .. } => panic!("expected an input event"),
        Event::Input {
            id,
            event_type,
            x,
            y,
            key,
            modifiers,
            value,
        } => {
            assert!(value.is_none());
            assert_eq!(*id, ElementId(5));
            assert_eq!(*event_type, EventType::KeyDown);
            assert!(x.is_none() && y.is_none());
            assert_eq!(key.as_deref(), Some("Enter"));
            let m = modifiers.expect("modifiers present");
            assert!(!m.ctrl && !m.alt && !m.shift && !m.cmd);
        }
    }
    assert_eq!(event_to_json(&event), raw);
}

#[test]
fn outside_click_event_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("event-outside-click-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let event = event_from_json(&raw).expect("event parses");
    match &event {
        Event::Menu { .. } => panic!("expected an input event"),
        Event::Input {
            id,
            event_type,
            x,
            y,
            key,
            modifiers,
            value,
        } => {
            assert_eq!(*id, ElementId(12));
            assert_eq!(*event_type, EventType::OutsideClick);
            assert_eq!(*x, Some(401.0));
            assert_eq!(*y, Some(93.0));
            assert!(key.is_none() && modifiers.is_none() && value.is_none());
        }
    }
    assert_eq!(event_to_json(&event), raw);
}

#[test]
fn focus_element_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-focus-element.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(
        cmd,
        Command::FocusElement {
            seq: 12,
            id: ElementId(3),
        }
    );
    assert_eq!(command_to_json(&cmd), raw);
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
        r#"{"v":1,"seq":0,"mutations":[{"op":"createElement","id":1,"elementType":"marquee"}]}"#,
    )
    .unwrap_err();
    assert_eq!(
        err,
        ProtocolError::UnknownElementType {
            got: "marquee".into()
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

#[test]
fn change_event_fixture_carries_value_both_ways() {
    let raw = fs::read_to_string(fixture_path("event-change-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let event = event_from_json(&raw).expect("event parses");
    assert_eq!(
        event,
        Event::Input {
            id: 7.into(),
            event_type: EventType::Change,
            x: None,
            y: None,
            key: None,
            modifiers: None,
            value: Some("ab".into()),
        }
    );
    assert_eq!(event_to_json(&event), raw);
}

/// Regression (caught by the Gate 3 GUI harness): adding an EventType enum
/// variant is not enough — the wire VALIDATION list must carry it too, or a
/// real setEventListener(outsideClick) batch is rejected cross-process while
/// direct tree.apply tests keep passing.
#[test]
fn set_event_listener_accepts_outside_click() {
    let raw = r#"{"v":1,"seq":1,"mutations":[{"op":"setEventListener","id":4,"eventType":"outsideClick","enabled":true}]}"#;
    let batch = from_json(raw).expect("batch with outsideClick listener parses");
    assert_eq!(batch.mutations.len(), 1);
}

#[test]
fn set_event_listener_rejects_unknown_event_type() {
    let raw = r#"{"v":1,"seq":1,"mutations":[{"op":"setEventListener","id":4,"eventType":"middleClick","enabled":true}]}"#;
    assert!(from_json(raw).is_err());
}

#[test]
fn dump_tree_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-dump-tree.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(cmd, Command::DumpTree { seq: 49 });
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn set_theme_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-set-theme.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    let mut tokens = std::collections::BTreeMap::new();
    tokens.insert("foreground".to_string(), "#cdd6f4cc".to_string());
    tokens.insert("surface".to_string(), "#181825".to_string());
    assert_eq!(cmd, Command::SetTheme { seq: 48, tokens });
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn reset_tree_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-reset-tree.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(cmd, Command::ResetTree { seq: 47 });
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn simulate_key_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-simulate-key.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(
        cmd,
        Command::SimulateKey {
            seq: 45,
            key: "enter".into()
        }
    );
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn simulate_mouse_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-simulate-mouse.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(
        cmd,
        Command::SimulateMouse {
            seq: 46,
            x: 300.0,
            y: 220.5
        }
    );
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn simulate_input_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-simulate-input.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(
        cmd,
        Command::SimulateInput {
            seq: 44,
            id: ElementId(7),
            text: "ab".into()
        }
    );
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn list_info_command_fixture_parses_and_emits_exactly() {
    let raw = fs::read_to_string(fixture_path("command-list-info.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let cmd = command_from_json(&raw).expect("command parses");
    assert_eq!(
        cmd,
        Command::ListInfo {
            seq: 33,
            id: ElementId(4)
        }
    );
    assert_eq!(command_to_json(&cmd), raw);
}

#[test]
fn list_element_batch_fixture_parses_both_ways() {
    let raw = fs::read_to_string(fixture_path("batch-list-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let batch = from_json(&raw).expect("batch parses");
    match &batch.mutations[0] {
        Mutation::CreateElement { element_type, .. } => {
            assert_eq!(*element_type, solid_gpui_protocol::ElementType::List);
        }
        other => panic!("expected createElement, got {other:?}"),
    }
    assert_eq!(to_json(&batch), raw);
}

#[test]
fn markdown_batch_fixture_parses_both_ways() {
    let raw = fs::read_to_string(fixture_path("batch-markdown-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let batch = from_json(&raw).expect("batch parses");
    match &batch.mutations[2] {
        Mutation::CreateElement { element_type, .. } => {
            assert_eq!(*element_type, solid_gpui_protocol::ElementType::Markdown);
        }
        other => panic!("expected markdown createElement, got {other:?}"),
    }
    let Mutation::SetText { id, text } = &batch.mutations[5] else {
        panic!("expected setText");
    };
    assert_eq!(*id, ElementId(2));
    assert!(text.contains("# solid-gpui markdown 🎉"));
    assert!(text.contains("```rust"));
    assert_eq!(to_json(&batch), raw);
}

#[test]
fn animation_batch_fixture_parses_both_ways() {
    let raw = fs::read_to_string(fixture_path("batch-animation-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let batch = from_json(&raw).expect("batch parses");
    let mut tree = RetainedTree::new();
    for m in &batch.mutations {
        tree.apply(m).expect("fixture applies");
    }
    // Round-trips byte-identically after compaction.
    assert_eq!(to_json(&batch), raw);
}

#[test]
fn style_state_batch_fixture_parses_both_ways() {
    let raw = fs::read_to_string(fixture_path("batch-style-state-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let batch = from_json(&raw).expect("batch parses");
    // Base style has no state; the two state layers carry hover/active.
    let mut state_layers = 0;
    for m in &batch.mutations {
        if let Mutation::SetStyle { state: Some(s), .. } = m {
            state_layers += 1;
            assert!(
                matches!(s, solid_gpui_protocol::StyleState::Hover)
                    || matches!(s, solid_gpui_protocol::StyleState::Active),
                "unexpected state {s:?}"
            );
        }
    }
    assert_eq!(
        state_layers, 2,
        "fixture carries exactly hover+active layers"
    );
    // Re-encode is byte-identical (canonical compact form).
    assert_eq!(to_json(&batch), raw);
}

#[test]
fn keys_batch_fixture_parses_both_ways() {
    let raw = fs::read_to_string(fixture_path("batch-keys-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let batch = from_json(&raw).expect("batch parses");
    match &batch.mutations[1] {
        Mutation::SetKeyBindings { id, bindings } => {
            assert_eq!(*id, 1.into());
            assert_eq!(bindings.len(), 2);
            assert_eq!(bindings[1], "ctrl-x ctrl-s");
        }
        other => panic!("expected setKeyBindings, got {other:?}"),
    }
    match &batch.mutations[2] {
        Mutation::SetEventListener { event_type, .. } => {
            assert!(matches!(event_type, solid_gpui_protocol::EventType::Keys));
        }
        other => panic!("expected setEventListener, got {other:?}"),
    }
    assert_eq!(to_json(&batch), raw);
}

#[test]
fn p4_commands_round_trip_with_camel_case_fields() {
    // Review r1 Major: enum-level serde rename_all does NOT rename variant
    // FIELDS — dialogSaveFile's suggestedName was silently dropped without
    // the variant-level rule. Pin every P4 payload's camelCase shape.
    let cases: Vec<(String, solid_gpui_protocol::Command)> = vec![
        (
            r#"{"type":"setTitle","seq":1,"title":"Notes"}"#.into(),
            solid_gpui_protocol::Command::SetTitle { seq: 1, title: "Notes".into() },
        ),
        (
            r#"{"type":"dialogSaveFile","seq":5,"directory":"/tmp","suggestedName":"notes.md"}"#.into(),
            solid_gpui_protocol::Command::DialogSaveFile {
                seq: 5,
                directory: Some("/tmp".into()),
                suggested_name: Some("notes.md".into()),
            },
        ),
        (
            r#"{"type":"dialogMessage","seq":3,"level":"warning","message":"m","answers":["a","b"]}"#.into(),
            solid_gpui_protocol::Command::DialogMessage {
                seq: 3,
                level: "warning".into(),
                message: "m".into(),
                detail: None,
                answers: vec!["a".into(), "b".into()],
            },
        ),
        (
            r#"{"type":"dialogOpenFile","seq":4,"files":true,"multiple":true}"#.into(),
            solid_gpui_protocol::Command::DialogOpenFile {
                seq: 4,
                files: Some(true),
                directories: None,
                multiple: Some(true),
                prompt: None,
            },
        ),
    ];
    for (wire, want) in cases {
        let cmd = command_from_json(&wire).unwrap_or_else(|e| panic!("{wire}: {e}"));
        assert_eq!(cmd, want, "decode mismatch for {wire}");
        // Re-encode is canonical: camelCase fields, optionals omitted.
        assert_eq!(command_to_json(&cmd), wire, "re-encode mismatch");
    }
}

#[test]
fn scrollbar_batch_fixture_parses_both_ways() {
    let raw = fs::read_to_string(fixture_path("batch-scrollbar-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let batch = from_json(&raw).expect("batch parses");
    match &batch.mutations[0] {
        Mutation::CreateElement { element_type, .. } => {
            assert!(matches!(
                element_type,
                solid_gpui_protocol::ElementType::Scrollbar
            ));
        }
        other => panic!("expected scrollbar createElement, got {other:?}"),
    }
    assert_eq!(to_json(&batch), raw);
}

#[test]
fn drag_batch_fixture_parses_both_ways() {
    let raw = fs::read_to_string(fixture_path("batch-drag-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let batch = from_json(&raw).expect("batch parses");
    match &batch.mutations[1] {
        Mutation::SetDragData { id, data } => {
            assert_eq!(*id, 1.into());
            assert_eq!(data, r#"{"itemId":42}"#);
        }
        other => panic!("expected setDragData, got {other:?}"),
    }
    match &batch.mutations[3] {
        Mutation::SetStyle { state, .. } => {
            assert!(matches!(
                state,
                Some(solid_gpui_protocol::StyleState::DragOver)
            ));
        }
        other => panic!("expected setStyle dragOver, got {other:?}"),
    }
    assert_eq!(to_json(&batch), raw);
}

#[test]
fn canvas_batch_fixture_parses_both_ways() {
    let raw = fs::read_to_string(fixture_path("batch-canvas-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let batch = from_json(&raw).expect("batch parses");
    match &batch.mutations[1] {
        Mutation::SetDrawList { id, items } => {
            assert_eq!(*id, 1.into());
            assert_eq!(items.len(), 3);
            assert!(
                matches!(&items[0], DrawItem::Rect { w, corner_radius: Some(4.), .. } if *w == 120.)
            );
            assert!(matches!(
                &items[1],
                DrawItem::Path {
                    stroke_width: Some(2.),
                    ..
                }
            ));
            assert!(matches!(&items[2], DrawItem::Text { text, .. } if text == "Q3"));
        }
        other => panic!("expected setDrawList, got {other:?}"),
    }
    assert_eq!(to_json(&batch), raw);
}

#[test]
fn set_menus_command_and_menu_event_round_trip() {
    // Command: full spec surface — item w/ all optionals, separator,
    // submenu, os_action.
    let command = Command::SetMenus {
        seq: 77,
        menus: vec![solid_gpui_protocol::MenuSpec {
            name: "File".into(),
            items: vec![
                solid_gpui_protocol::MenuItemSpec::Item {
                    label: "Open…".into(),
                    id: "file.open".into(),
                    keystroke: Some("cmd-o".into()),
                    disabled: None,
                    checked: None,
                    os_action: None,
                },
                solid_gpui_protocol::MenuItemSpec::Separator,
                solid_gpui_protocol::MenuItemSpec::Item {
                    label: "Copy".into(),
                    id: "edit.copy".into(),
                    keystroke: None,
                    disabled: Some(false),
                    checked: Some(true),
                    os_action: Some(solid_gpui_protocol::OsActionKind::Copy),
                },
                solid_gpui_protocol::MenuItemSpec::Submenu {
                    name: "Export".into(),
                    items: vec![solid_gpui_protocol::MenuItemSpec::Item {
                        label: "PDF".into(),
                        id: "export.pdf".into(),
                        keystroke: None,
                        disabled: Some(true),
                        checked: None,
                        os_action: None,
                    }],
                },
            ],
        }],
    };
    let json = command_to_json(&command);
    assert!(json.contains("\"type\":\"setMenus\""), "{json}");
    assert!(json.contains("\"keystroke\":\"cmd-o\""), "{json}");
    let parsed = command_from_json(&json).expect("re-parses");
    assert_eq!(parsed, command);

    // Optionals stay off the wire when absent.
    let minimal = Command::SetMenus {
        seq: 1,
        menus: vec![solid_gpui_protocol::MenuSpec {
            name: "m".into(),
            items: vec![solid_gpui_protocol::MenuItemSpec::Item {
                label: "L".into(),
                id: "x".into(),
                keystroke: None,
                disabled: None,
                checked: None,
                os_action: None,
            }],
        }],
    };
    let mj = command_to_json(&minimal);
    assert!(
        !mj.contains("keystroke") && !mj.contains("disabled"),
        "{mj}"
    );

    // Menu event wire shape + accessors.
    let event = Event::Menu {
        item_id: "file.open".into(),
    };
    let ej = event_to_json(&event);
    assert_eq!(ej, r#"{"type":"menu","itemId":"file.open"}"#);
    assert_eq!(event_from_json(&ej).unwrap(), event);
    assert_eq!(event.element_id(), None);
    assert_eq!(event.event_type(), None);

    // Input events still report their element.
    let input = Event::Input {
        id: ElementId(9),
        event_type: EventType::Click,
        x: None,
        y: None,
        key: None,
        modifiers: None,
        value: None,
    };
    assert_eq!(input.element_id(), Some(ElementId(9)));
}

#[test]
fn media_batch_fixture_parses_both_ways() {
    let raw = fs::read_to_string(fixture_path("batch-media-01.json"))
        .expect("fixture readable")
        .trim()
        .to_string();
    let batch = from_json(&raw).expect("batch parses");
    assert!(matches!(
        &batch.mutations[0],
        Mutation::CreateElement {
            element_type: ElementType::Svg,
            ..
        }
    ));
    assert!(matches!(&batch.mutations[1], Mutation::SetText { .. }));
    assert!(matches!(&batch.mutations[4], Mutation::SetSrc { src, .. } if src == "/tmp/photo.png"));
    assert!(matches!(
        &batch.mutations[6],
        Mutation::SetDeferred { deferred: true, .. }
    ));
    assert!(matches!(
        &batch.mutations[8],
        Mutation::SetAnchored {
            anchor: Some(solid_gpui_protocol::AnchorKind::TopRight),
            ..
        }
    ));
    assert_eq!(to_json(&batch), raw);
}
