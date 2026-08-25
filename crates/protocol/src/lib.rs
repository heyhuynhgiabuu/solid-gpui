//! Mutation wire protocol shared by the JS renderer and the native helper.
//! Wire format: UTF-8 JSON objects, one per line (NDJSON) at the transport
//! layer. This crate owns parsing/emitting only; semantic validation of a
//! mutation sequence (parent exists, no cycles, single root) belongs to the
//! retained tree in the helper, not here.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;

pub mod retained;

pub use retained::{Node, RetainedTree};

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
    "change",
    "submit",
];

pub const ELEMENT_TYPES: &[&str] = &["div", "text", "input", "textarea", "list", "markdown"];

/// Numeric id of a host element. 0 is reserved and never valid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ElementId(pub u32);

impl From<u32> for ElementId {
    fn from(v: u32) -> Self {
        ElementId(v)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ElementType {
    Div,
    Text,
    Input,
    Textarea,
    /// Virtualized list: the retained tree holds every item, gpui's List
    /// paints only the visible subset. Children are the items.
    List,
    /// Rich-text block: the node's `text` holds the markdown source; the
    /// helper parses and renders it entirely Rust-side. No wire children —
    /// the rendered subtree is helper-owned (validation rejects attach).
    Markdown,
}

/// Interaction state a state-layer style applies under. Closed set (the
/// helper must know every state to wire gpui interactivity); mirrors the
/// EventType asymmetry: unknown style KEYS stay open, unknown STATES error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StyleState {
    Hover,
    Active,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
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
    Change,
    Submit,
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

impl StyleValue {
    /// The string form, if this is a text value.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            StyleValue::Text(s) => Some(s),
            StyleValue::Number(_) => None,
        }
    }
}

pub type StyleMap = BTreeMap<String, StyleValue>;

/// Style keys that setAnimation accepts. Closed set (unlike setStyle's
/// forward-compatible open set): interpolation needs a real numeric render
/// path on the helper side, so animating an unsupported key must fail
/// honestly instead of silently doing nothing.
pub const ANIMATABLE_STYLE_KEYS: &[&str] = &[
    "width",
    "height",
    "minWidth",
    "minHeight",
    // padding/paddingX/paddingY expand to physical keys on the TS side
    // before anything is sent, so the wire only ever carries these four.
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "gap",
    "borderRadius",
    "fontSize",
    "flexGrow",
    "flexShrink",
    "opacity",
];

/// Easing curves setAnimation accepts (closed set, camelCase wire names).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Easing {
    #[serde(rename = "linear")]
    Linear,
    #[serde(rename = "easeIn")]
    EaseIn,
    #[serde(rename = "easeOut")]
    EaseOut,
    #[serde(rename = "easeInOut")]
    EaseInOut,
}

impl Easing {
    /// Wire name -> curve. `None` for unknown names (rejected upstream).
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "linear" => Some(Easing::Linear),
            "easeIn" => Some(Easing::EaseIn),
            "easeOut" => Some(Easing::EaseOut),
            "easeInOut" => Some(Easing::EaseInOut),
            _ => None,
        }
    }
}

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
        /// Style-STATE layer ("hover"/"active") applied on top of the base
        /// style when gpui reports the matching interaction state. None =
        /// base style (backward compatible: absent field decodes as None).
        /// Closed set like EventType — the helper must know every state.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        state: Option<StyleState>,
    },
    SetText {
        id: ElementId,
        text: String,
    },
    /// Transition the element's current numeric values for `target`'s keys to
    /// the target values over `transition_ms`. Targets must be numeric and
    /// confined to [`ANIMATABLE_STYLE_KEYS`]; each key must already hold a
    /// numeric value on the element (a well-defined start). The target is
    /// merged into the element's static style at apply time, so the end state
    /// sticks without any further protocol traffic; the helper substitutes
    /// interpolated values each frame until the transition completes.
    #[serde(rename_all = "camelCase")]
    SetAnimation {
        id: ElementId,
        target: StyleMap,
        transition_ms: u32,
        /// One of linear|easeIn|easeOut|easeInOut; None means easeOut.
        easing: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SetValue {
        id: ElementId,
        /// Input/textarea document value. Only valid on input/textarea
        /// element types (validation and rendering agree).
        value: String,
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

/// Machine-readable cause of an error reply. Closed set; grows only with a
/// protocol minor version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplyCode {
    /// The batch line failed decoding. `seq` is `None` because a malformed
    /// line cannot be trusted to carry a usable sequence number.
    DecodeFailed,
    /// The batch decoded but a mutation failed to apply (validation).
    /// `seq` is `Some(..)`: the reply correlates to the caller.
    ApplyFailed,
    /// A command line named a command this build does not know. Closed set,
    /// same growth rule as the rest of the taxonomy.
    UnknownCommand,
    /// The command is valid but not available in the current helper mode
    /// (e.g. getStats/captureFrame in `--stdio` transport mode, no GUI).
    Unsupported,
}

/// JS→helper side request that is NOT a mutation batch (queries, captures).
/// Commands correlate by their own `seq`, sharing no counter with batches.
/// The `type` field carries the command name itself — the demultiplexer
/// matches it against this closed set after reply/event decoders decline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    GetStats {
        seq: u32,
    },

    CaptureFrame {
        seq: u32,
        /// Absolute path where the helper writes the PNG of its own window.
        path: String,
    },

    ScrollTo {
        seq: u32,
        /// Retained element id holding a live scroll handle.
        id: ElementId,
        /// Target offset in px (absolute, not relative).
        x: f64,
        y: f64,
    },

    GetScrollOffset {
        seq: u32,
        id: ElementId,
    },

    FocusElement {
        seq: u32,
        id: ElementId,
    },

    /// Apply a text edit to a focused input/textarea through the same code
    /// path as the platform IME, emitting a change event. Test seam for the
    /// helper→JS change path (no real keystrokes in headless tests) and an
    /// automation/a11y hook (type a value programmatically).
    SimulateInput {
        seq: u32,
        id: ElementId,
        text: String,
    },

    /// Query a virtual list's live metrics: item count, how many items the
    /// last frame actually painted (virtualization proof), and whether it is
    /// scrolled to the end (followTail chat position).
    ListInfo {
        seq: u32,
        id: ElementId,
    },
}

/// Serialize a command to one JSON line. Infallible for this type shape.
pub fn command_to_json(command: &Command) -> String {
    serde_json::to_string(command).expect("serializing a plain data command cannot fail")
}

/// Parse one command line. Unknown command names are `InvalidShape` (closed
/// set, mirroring unknownOp), not `InvalidJson`.
pub fn command_from_json(s: &str) -> Result<Command, ProtocolError> {
    let value: serde_json::Value =
        serde_json::from_str(s).map_err(|e| ProtocolError::InvalidJson {
            message: e.to_string(),
        })?;
    let type_str = value.get("type").and_then(|t| t.as_str());
    if !matches!(
        type_str,
        Some("getStats")
            | Some("captureFrame")
            | Some("scrollTo")
            | Some("getScrollOffset")
            | Some("focusElement")
            | Some("simulateInput")
            | Some("listInfo")
    ) {
        return Err(ProtocolError::InvalidShape {
            path: "type".into(),
            message: format!(
                "unknown command {:?}; expected getStats|captureFrame|scrollTo|getScrollOffset|focusElement|simulateInput|listInfo",
                type_str.unwrap_or("<missing>")
            ),
        });
    }
    serde_json::from_value(value).map_err(|e| ProtocolError::InvalidJson {
        message: e.to_string(),
    })
}

/// Helper→JS direction of the wire: one NDJSON reply per received batch or
/// command line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Reply {
    #[serde(rename_all = "camelCase")]
    Ack {
        seq: u32,
        /// Number of mutations consumed (until the retained tree exists,
        /// this is the decoded count; Slice 4 makes it the applied count).
        applied: u32,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        seq: Option<u32>,
        code: ReplyCode,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Result {
        seq: u32,
        /// Command-specific payload (getStats object, captureFrame metadata).
        /// Opaque to the protocol; each command defines its own shape.
        value: serde_json::Value,
    },
}

/// Serialize a reply to one JSON line. Infallible for this type shape.
pub fn reply_to_json(reply: &Reply) -> String {
    serde_json::to_string(reply).expect("serializing a plain data reply cannot fail")
}

/// Parse one reply line (used by the JS-side contract tests via fixtures;
/// the TS client decodes independently).
pub fn reply_from_json(s: &str) -> Result<Reply, ProtocolError> {
    serde_json::from_str(s).map_err(|e| ProtocolError::InvalidJson {
        message: e.to_string(),
    })
}

/// Keyboard modifier flags carried on keyDown/keyUp events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Modifiers {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub cmd: bool,
}

/// Helper→JS asynchronous input event (NOT a reply to any batch — events are
/// pushed whenever the user interacts, between batches).
///
/// One variant covers all input kinds: `eventType` discriminates and the
/// optional fields are present only where meaningful (x/y for pointers,
/// key/modifiers for keys, nothing for focus/blur). skip_serializing_if keeps
/// absent fields off the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Event {
    #[serde(rename = "event", rename_all = "camelCase")]
    Input {
        id: ElementId,
        event_type: EventType,
        #[serde(skip_serializing_if = "Option::is_none")]
        x: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        y: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        key: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        modifiers: Option<Modifiers>,
        /// New document value for change events (input/textarea edits).
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
}

impl Event {
    /// The element the event targets.
    pub fn element_id(&self) -> ElementId {
        match self {
            Event::Input { id, .. } => *id,
        }
    }

    /// The event type discriminator (mirrors the wire's `eventType`).
    pub fn event_type(&self) -> EventType {
        match self {
            Event::Input { event_type, .. } => *event_type,
        }
    }
}

/// Serialize an event to one JSON line. Infallible for this type shape.
pub fn event_to_json(event: &Event) -> String {
    serde_json::to_string(event).expect("serializing a plain data event cannot fail")
}

/// Parse one event line (contract tests; the TS client decodes independently).
pub fn event_from_json(s: &str) -> Result<Event, ProtocolError> {
    serde_json::from_str(s).map_err(|e| ProtocolError::InvalidJson {
        message: e.to_string(),
    })
}

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
    "setValue",
    "setAnimation",
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
            | Mutation::SetValue { id, .. }
            | Mutation::SetAnimation { id, .. }
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
