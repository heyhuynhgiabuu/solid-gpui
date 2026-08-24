//! Mutation wire protocol shared by the JS renderer and the native helper.
//!
//! Wire format: UTF-8 JSON objects, one per line (NDJSON) at the transport
//! layer. This crate owns parsing/emitting only; semantic validation of a
//! mutation sequence (parent exists, no cycles, single root) belongs to the
//! retained tree in the helper, not here.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

pub const PROTOCOL_VERSION: u32 = 1;

pub const EVENT_TYPES: &[&str] = &[
    "click",
    "mouseDown",
    "mouseUp",
    "mouseEnter",
    "mouseLeave",
    "keyDown",
    "keyUp",
    "focus",
    "blur",
    "scroll",
];

pub const ELEMENT_TYPES: &[&str] = &["div", "text"];

/// Numeric id of a host element. 0 is reserved and never valid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ElementId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ElementType {
    Div,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventType {
    Click,
    MouseDown,
    MouseUp,
    MouseEnter,
    MouseLeave,
    KeyDown,
    KeyUp,
    Focus,
    Blur,
    Scroll,
}

/// A style value is a JSON number (kept exact via `serde_json::Number`) or a
/// string. Unknown style KEYS are accepted so an older helper can ignore
/// keys added by a newer renderer (forward compatibility).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StyleValue {
    Number(serde_json::Number),
    Text(String),
}

pub type StyleMap = BTreeMap<String, StyleValue>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Mutation {
    #[serde(rename_all = "camelCase")]
    CreateElement {
        id: ElementId,
        element_type: ElementType,
    },
    DestroyElement {
        id: ElementId,
    },
    #[serde(rename_all = "camelCase")]
    AppendChild {
        parent_id: ElementId,
        child_id: ElementId,
    },
    #[serde(rename_all = "camelCase")]
    RemoveChild {
        parent_id: ElementId,
        child_id: ElementId,
    },
    #[serde(rename_all = "camelCase")]
    InsertBefore {
        parent_id: ElementId,
        child_id: ElementId,
        before_id: ElementId,
    },
    SetStyle {
        id: ElementId,
        style: StyleMap,
    },
    SetText {
        id: ElementId,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    SetEventListener {
        id: ElementId,
        event_type: EventType,
        enabled: bool,
    },
    SetRoot {
        id: ElementId,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MutationBatch {
    pub v: u32,
    pub seq: u32,
    pub mutations: Vec<Mutation>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProtocolError {
    InvalidJson { message: String },
    UnsupportedVersion { got: u64 },
    UnknownOp { got: String },
    UnknownEventType { got: String },
    UnknownElementType { got: String },
    InvalidShape { path: String, message: String },
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProtocolError::InvalidJson { message } => write!(f, "invalid JSON: {message}"),
            ProtocolError::UnsupportedVersion { got } => {
                write!(
                    f,
                    "unsupported protocol version {got} (expected {PROTOCOL_VERSION})"
                )
            }
            ProtocolError::UnknownOp { got } => write!(f, "unknown mutation op `{got}`"),
            ProtocolError::UnknownEventType { got } => write!(f, "unknown event type `{got}`"),
            ProtocolError::UnknownElementType { got } => write!(f, "unknown element type `{got}`"),
            ProtocolError::InvalidShape { path, message } => {
                write!(f, "invalid shape at `{path}`: {message}")
            }
        }
    }
}

impl std::error::Error for ProtocolError {}

/// Semantic failure while applying a decoded mutation (unknown parent,
/// double root, ...). Transport never sees these; they describe retained-tree
/// violations.
#[derive(Debug, Clone, PartialEq)]
pub enum ApplyError {
    InvalidMutation { message: String },
}

impl fmt::Display for ApplyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApplyError::InvalidMutation { message } => write!(f, "invalid mutation: {message}"),
        }
    }
}

impl std::error::Error for ApplyError {}

/// Consumer of decoded mutations. Implemented by the helper's retained tree;
/// tests implement it with a recorder to prove decode fidelity.
pub trait MutationHandler {
    fn apply(&mut self, mutation: &Mutation) -> Result<(), ApplyError>;
}

/// Parse one NDJSON batch line. Recoverable wire failures are `Err`, never
/// panics.
pub fn from_json(s: &str) -> Result<MutationBatch, ProtocolError> {
    let value: serde_json::Value =
        serde_json::from_str(s).map_err(|e| ProtocolError::InvalidJson {
            message: e.to_string(),
        })?;
    from_value(value)
}

const KNOWN_OPS: &[&str] = &[
    "createElement",
    "destroyElement",
    "appendChild",
    "removeChild",
    "insertBefore",
    "setStyle",
    "setText",
    "setEventListener",
    "setRoot",
];

/// Pre-checks give precise error variants (unknown op / event / element type,
/// unsupported version) that serde's blanket error cannot express; serde then
/// handles the remaining structural validation.
fn from_value(v: serde_json::Value) -> Result<MutationBatch, ProtocolError> {
    {
        let obj = v.as_object().ok_or_else(|| ProtocolError::InvalidShape {
            path: "$".into(),
            message: "expected an object".into(),
        })?;

        match obj.get("v") {
            Some(serde_json::Value::Number(n)) => {
                let got = n.as_u64().ok_or_else(|| ProtocolError::InvalidShape {
                    path: "v".into(),
                    message: "expected an unsigned integer".into(),
                })?;
                if got != u64::from(PROTOCOL_VERSION) {
                    return Err(ProtocolError::UnsupportedVersion { got });
                }
            }
            Some(_) => {
                return Err(ProtocolError::InvalidShape {
                    path: "v".into(),
                    message: "expected the number 1".into(),
                });
            }
            None => {
                return Err(ProtocolError::InvalidShape {
                    path: "v".into(),
                    message: "missing field".into(),
                });
            }
        }

        let mutations = obj
            .get("mutations")
            .and_then(|m| m.as_array())
            .ok_or_else(|| ProtocolError::InvalidShape {
                path: "mutations".into(),
                message: "expected an array".into(),
            })?;

        for (i, m) in mutations.iter().enumerate() {
            let p = format!("mutations[{i}]");
            let mo = m.as_object().ok_or_else(|| ProtocolError::InvalidShape {
                path: p.clone(),
                message: "expected an object".into(),
            })?;
            let op = mo.get("op").and_then(|o| o.as_str()).ok_or_else(|| {
                ProtocolError::InvalidShape {
                    path: format!("{p}.op"),
                    message: "expected a string".into(),
                }
            })?;
            if !KNOWN_OPS.contains(&op) {
                return Err(ProtocolError::UnknownOp { got: op.into() });
            }
            if op == "setEventListener"
                && let Some(et) = mo.get("eventType")
            {
                let s = et.as_str().ok_or_else(|| ProtocolError::InvalidShape {
                    path: format!("{p}.eventType"),
                    message: "expected a string".into(),
                })?;
                if !EVENT_TYPES.contains(&s) {
                    return Err(ProtocolError::UnknownEventType { got: s.into() });
                }
            }
            if op == "createElement"
                && let Some(et) = mo.get("elementType")
            {
                let s = et.as_str().ok_or_else(|| ProtocolError::InvalidShape {
                    path: format!("{p}.elementType"),
                    message: "expected a string".into(),
                })?;
                if !ELEMENT_TYPES.contains(&s) {
                    return Err(ProtocolError::UnknownElementType { got: s.into() });
                }
            }
        }
    }

    // Known limitation: serde's structural errors surface as path "$" with
    // its message (usually with line/col), while TS reports precise per-field
    // paths. Full path parity is deferred until the committed Rust→TS parity
    // test lands (Slice 2); error kinds already match 1:1.
    let batch: MutationBatch =
        serde_json::from_value(v).map_err(|e| ProtocolError::InvalidShape {
            path: "$".into(),
            message: e.to_string(),
        })?;

    // 0 is reserved; serde accepts it as u32, so reject it after parsing.
    for (i, m) in batch.mutations.iter().enumerate() {
        let zero_field = match m {
            Mutation::CreateElement { id, .. }
            | Mutation::DestroyElement { id }
            | Mutation::SetStyle { id, .. }
            | Mutation::SetText { id, .. }
            | Mutation::SetEventListener { id, .. }
            | Mutation::SetRoot { id } => (id.0 == 0).then_some("id"),
            Mutation::AppendChild {
                parent_id,
                child_id,
            }
            | Mutation::RemoveChild {
                parent_id,
                child_id,
            } => {
                if parent_id.0 == 0 {
                    Some("parentId")
                } else {
                    (child_id.0 == 0).then_some("childId")
                }
            }
            Mutation::InsertBefore {
                parent_id,
                child_id,
                before_id,
            } => {
                if parent_id.0 == 0 {
                    Some("parentId")
                } else if child_id.0 == 0 {
                    Some("childId")
                } else {
                    (before_id.0 == 0).then_some("beforeId")
                }
            }
        };
        if let Some(field) = zero_field {
            return Err(ProtocolError::InvalidShape {
                path: format!("mutations[{i}].{field}"),
                message: "element ids must be >= 1 (0 is reserved)".into(),
            });
        }
    }

    Ok(batch)
}

/// Serialize a batch to one JSON line. Infallible for this type shape.
pub fn to_json(batch: &MutationBatch) -> String {
    serde_json::to_string(batch).expect("serializing a plain data batch cannot fail")
}
