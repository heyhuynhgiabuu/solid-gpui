use solid_gpui_protocol::{
    ApplyError, Mutation, MutationBatch, MutationHandler, ProtocolError, from_json, to_json,
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
    assert!(matches!(batch.mutations[0], Mutation::SetRoot { .. }));
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
