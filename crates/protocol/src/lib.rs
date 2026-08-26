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
    "keys",
    "dragStart",
    "drop",
];

pub const ELEMENT_TYPES: &[&str] = &[
    "div",
    "text",
    "input",
    "textarea",
    "list",
    "markdown",
    "scrollbar",
    "canvas",
    "svg",
    "img",
];

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
    /// Scrollbar overlay: wraps EXACTLY ONE scrollable child (div with
    /// overflow, or a list); the helper draws the bar host-side and drives
    /// the child's scroll handle (drag works even off the track).
    Scrollbar,
    /// Recorded draw list (P8): the node's `draw_list` is replaced
    /// wholesale on every setDrawList; no readback, no measure, no
    /// transforms — the pixels are GPU-side. No children (validation
    /// rejects attach, like text nodes); no interactive props (like
    /// markdown). Base styles (size/background) apply.
    Canvas,
    /// Monochrome icon rendered from raw SVG markup (the node's `text`
    /// IS the source); tinted by the `color` style key. Helper-owned
    /// subtree: no children, no interactive props (like markdown/canvas).
    Svg,
    /// Raster image from an absolute file path or http(s) URI (`setSrc`).
    /// gpui reads file paths directly; no asset source needed. Same
    /// helper-owned contracts as svg.
    Img,
}

/// Interaction state a state-layer style applies under. Closed set (the
/// helper must know every state to wire gpui interactivity); mirrors the
/// EventType asymmetry: unknown style KEYS stay open, unknown STATES error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StyleState {
    Hover,
    Active,
    /// Applied while a drag is held over the element (dragOverStyle prop).
    DragOver,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventType {
    Click,
    /// Per-edit input notification (DOM onInput semantics): fires for every
    /// text edit while typing, IME composition included.
    Input,
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
    /// A `keys` binding fired (shortcut/sequence match). The event's `key`
    /// field carries the matched binding string ("cmd-k", "ctrl-x ctrl-s").
    Keys,
    /// A drag started on this element (dragData prop). The event's `value`
    /// field carries the JSON payload string.
    DragStart,
    /// A drag released over this drop target. The event's `value` field
    /// carries the dragged JSON payload string.
    Drop,
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

/// Font face style for one P11 text run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextRunStyle {
    Normal,
    Italic,
    Oblique,
}

/// One substring in a text element's wholesale styled-runs value. The helper
/// concatenates these substrings and derives the UTF-8 byte lengths gpui
/// requires, so JavaScript never has to send UTF-16-derived offsets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRun {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<TextRunStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
}

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

/// One recorded draw op in a canvas element's draw list (P8). Coordinates
/// are absolute pixels within the canvas's own bounds (origin top-left);
/// the list is replaced wholesale — append semantics do not exist.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DrawItem {
    /// Filled axis-aligned rectangle (optional rounded corners).
    #[serde(rename_all = "camelCase")]
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        color: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        corner_radius: Option<f32>,
    },
    /// Polyline or polygon: `closed` fills the shape, otherwise it strokes
    /// with `stroke_width` (default 1 when omitted on open paths).
    #[serde(rename_all = "camelCase")]
    Path {
        /// Vertex pairs [x, y, x, y, ...] — flat keeps the wire compact.
        points: Vec<f32>,
        color: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stroke_width: Option<f32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        closed: Option<bool>,
    },
    /// Single-line text run (no wrapping; `\n` rejected by validation).
    #[serde(rename_all = "camelCase")]
    Text {
        x: f32,
        y: f32,
        text: String,
        /// Font size in pixels.
        size: f32,
        color: String,
    },
}

/// Which corner/edge-center of an anchored element pins to the render
/// location (P10). Closed set — the helper must know every anchor to map
/// onto gpui's `Anchor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AnchorKind {
    #[serde(rename = "topLeft")]
    TopLeft,
    #[serde(rename = "topRight")]
    TopRight,
    #[serde(rename = "bottomLeft")]
    BottomLeft,
    #[serde(rename = "bottomRight")]
    BottomRight,
    #[serde(rename = "topCenter")]
    TopCenter,
    #[serde(rename = "bottomCenter")]
    BottomCenter,
    #[serde(rename = "leftCenter")]
    LeftCenter,
    #[serde(rename = "rightCenter")]
    RightCenter,
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
    /// Replace a text element's single wrapping string and its inline runs
    /// atomically. Runs carry substrings rather than byte offsets; the helper
    /// computes the UTF-8 lengths required by gpui.
    #[serde(rename_all = "camelCase")]
    SetTextRuns {
        id: ElementId,
        runs: Vec<TextRun>,
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
    /// Configure drag & drop for the element: `data` is a JSON string (the
    /// payload carried to drop targets); an empty string clears drag source
    /// behavior. Drop targets register onDrop listeners normally.
    /// Set the media source of an img element: absolute file path or
    /// http(s) URI. Only valid on img elements.
    #[serde(rename_all = "camelCase")]
    SetSrc {
        id: ElementId,
        src: String,
    },
    /// Paint this element after all non-deferred ancestors (overlay layer,
    /// P10). Universal: any element can be lifted into the deferred pass.
    #[serde(rename_all = "camelCase")]
    SetDeferred {
        id: ElementId,
        deferred: bool,
    },
    /// Wrap this element in gpui's anchored overlay: the element escapes
    /// ancestor clipping and pins the given corner of itself to its render
    /// location (window coordinates), snapping to window edges on overflow.
    /// None clears. Universal.
    #[serde(rename_all = "camelCase")]
    SetAnchored {
        id: ElementId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor: Option<AnchorKind>,
    },
    /// Replace the canvas element's recorded draw list (P8) wholesale.
    /// Only valid on canvas elements; validation rejects anything else.
    #[serde(rename_all = "camelCase")]
    SetDrawList {
        id: ElementId,
        items: Vec<DrawItem>,
    },
    #[serde(rename_all = "camelCase")]
    SetDragData {
        id: ElementId,
        data: String,
    },
    /// Install the element's key bindings (shortcuts/sequences). Each entry
    /// is a keystroke string; spaces separate a sequence ("ctrl-x ctrl-s").
    /// Bindings fire while the element holds focus (elements with bindings
    /// become focusable); the fired binding reports back as a `keys` event.
    #[serde(rename_all = "camelCase")]
    SetKeyBindings {
        id: ElementId,
        bindings: Vec<String>,
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
/// One application menu with its items (P9). Replaced wholesale by every
/// setMenus call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSpec {
    pub name: String,
    pub items: Vec<MenuItemSpec>,
}

/// One entry in a menu. Tagged on the wire via `"type"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MenuItemSpec {
    /// A clickable action; fires a `menu` event with this item's `id`.
    #[serde(rename_all = "camelCase")]
    Item {
        label: String,
        /// Stable identifier echoed to JS when picked.
        id: String,
        /// Keystroke shown next to the label ("cmd-o"); also bound so the
        /// shortcut works globally. Omit for no shortcut.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        keystroke: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        disabled: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        checked: Option<bool>,
        /// Native macOS edit behavior (cut/copy/paste/…): macOS performs the
        /// selector itself and NO menu event reaches JS for that pick.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        os_action: Option<OsActionKind>,
    },
    Separator,
    #[serde(rename_all = "camelCase")]
    Submenu {
        name: String,
        items: Vec<MenuItemSpec>,
    },
}

/// Native selectors macOS can wire a menu item to (closed set).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OsActionKind {
    #[serde(rename = "cut")]
    Cut,
    #[serde(rename = "copy")]
    Copy,
    #[serde(rename = "paste")]
    Paste,
    #[serde(rename = "selectAll")]
    SelectAll,
    #[serde(rename = "undo")]
    Undo,
    #[serde(rename = "redo")]
    Redo,
}

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

    /// Replace the application menu bar wholesale (P9, macOS). Menu item
    /// clicks come back as `menu` events carrying the item's stable `id`.
    #[serde(rename_all = "camelCase")]
    SetMenus {
        seq: u32,
        menus: Vec<MenuSpec>,
    },

    /// Set the window's title bar text.
    SetTitle {
        seq: u32,
        title: String,
    },

    /// Imperative window actions (closed action set).
    WindowAction {
        seq: u32,
        /// One of minimize|zoom|toggleFullscreen|activate.
        action: String,
    },

    /// Modal message dialog; resolves with the clicked answer's index.
    DialogMessage {
        seq: u32,
        /// One of info|warning|critical.
        level: String,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
        /// Button labels, left to right.
        answers: Vec<String>,
    },

    /// Open-file dialog; resolves with chosen paths, or null when cancelled.
    DialogOpenFile {
        seq: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        files: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        directories: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        multiple: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prompt: Option<String>,
    },

    /// Save-file dialog; resolves with a path, or null when cancelled.
    #[serde(rename_all = "camelCase")]
    DialogSaveFile {
        seq: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        directory: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        suggested_name: Option<String>,
    },

    /// Show the path in Finder (platform equivalent).
    ShellRevealPath {
        seq: u32,
        path: String,
    },

    /// Hand the path to the application owning its type.
    ShellOpenPath {
        seq: u32,
        path: String,
    },

    /// Scroll a list element to bring item `index` to the viewport top.
    ScrollToItem {
        seq: u32,
        /// Retained element id of the list.
        id: ElementId,
        /// Absolute item index (clamped to the item count).
        index: u32,
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
            | Some("setMenus")
            | Some("setTitle")
            | Some("windowAction")
            | Some("dialogMessage")
            | Some("dialogOpenFile")
            | Some("dialogSaveFile")
            | Some("shellRevealPath")
            | Some("shellOpenPath")
            | Some("scrollToItem")
            | Some("scrollTo")
            | Some("getScrollOffset")
            | Some("focusElement")
            | Some("simulateInput")
            | Some("listInfo")
    ) {
        return Err(ProtocolError::InvalidShape {
            path: "type".into(),
            message: format!(
                "unknown command {:?}; expected getStats|captureFrame|scrollTo|getScrollOffset|focusElement|simulateInput|listInfo|setMenus|setTitle|windowAction|dialogMessage|dialogOpenFile|dialogSaveFile|shellRevealPath|shellOpenPath|scrollToItem",
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
    /// A menu item was picked (P9; app-level menus have no element).
    #[serde(rename = "menu", rename_all = "camelCase")]
    Menu {
        /// The picked item's stable identifier from the setMenus spec.
        item_id: String,
    },
}

impl Event {
    /// The element the event targets, if it is an element-scoped event
    /// (menu events are app-level and target nothing).
    pub fn element_id(&self) -> Option<ElementId> {
        match self {
            Event::Input { id, .. } => Some(*id),
            Event::Menu { .. } => None,
        }
    }

    /// The event type discriminator (mirrors the wire's `eventType`);
    /// None for non-Input events.
    pub fn event_type(&self) -> Option<EventType> {
        match self {
            Event::Input { event_type, .. } => Some(*event_type),
            Event::Menu { .. } => None,
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
    "setTextRuns",
    "setKeyBindings",
    "setDrawList",
    "setSrc",
    "setDeferred",
    "setAnchored",
    "setDragData",
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
        if let Mutation::SetTextRuns { runs, .. } = m {
            for (j, run) in runs.iter().enumerate() {
                if run.text.is_empty() {
                    return Err(ProtocolError::InvalidShape {
                        path: format!("mutations[{i}].runs[{j}].text"),
                        message: "expected a non-empty string".into(),
                    });
                }
                if run
                    .weight
                    .is_some_and(|weight| !(100..=900).contains(&weight))
                {
                    return Err(ProtocolError::InvalidShape {
                        path: format!("mutations[{i}].runs[{j}].weight"),
                        message: "expected an integer in 100..=900".into(),
                    });
                }
            }
        }
        let zero_field = match m {
            Mutation::CreateElement { id, .. }
            | Mutation::DestroyElement { id }
            | Mutation::SetStyle { id, .. }
            | Mutation::SetDrawList { id, .. }
            | Mutation::SetSrc { id, .. }
            | Mutation::SetDeferred { id, .. }
            | Mutation::SetAnchored { id, .. }
            | Mutation::SetKeyBindings { id, .. }
            | Mutation::SetDragData { id, .. }
            | Mutation::SetText { id, .. }
            | Mutation::SetTextRuns { id, .. }
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
