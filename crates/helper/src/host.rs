//! HostView: the GPUI view that renders the retained tree each frame.

use crate::frame_stats::FrameStats;
use gpui::{
    AnyElement, App, Bounds, Context, Div, Element, FocusHandle, FollowMode, InputHandler,
    InteractiveElement, IntoElement, LayoutId, ListAlignment, ListState, ParentElement, Pixels,
    Point, Render, Rgba, ScrollHandle, SharedString, StatefulInteractiveElement, Style, Styled,
    UTF16Selection, WeakEntity, Window, div, list, px, rgb, rgba, size,
};
use solid_gpui_protocol::EventType;
use solid_gpui_protocol::StyleMap;
use solid_gpui_protocol::{ElementId, ElementType, Event, RetainedTree, StyleValue};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::ops::Range;
use std::rc::Rc;

/// Live scroll handles for scrollable nodes, keyed by element id. Lazy-created
/// at render; pruned in [`HostView::render`] once the tree drops the id. Rc /
/// RefCell because `build_element` reaches them through a `&Context`, not a
/// `&mut HostView`.
type ScrollHandles = Rc<RefCell<HashMap<ElementId, ScrollHandle>>>;

/// Persistent focus handles for focusable elements, keyed by element id.
/// Same lifecycle contract as ScrollHandles: lazy get-or-create at render,
/// pruned per frame once the tree drops the id. Rc / RefCell because
/// build_element reaches them through a &Context, not a &mut HostView.
type FocusHandles = Rc<RefCell<HashMap<ElementId, FocusHandle>>>;

/// Live editable state per input/textarea element. Keyed by element id,
/// shared with the per-frame platform InputHandler. Same lifecycle contract
/// as the other handle maps: lazy at render, pruned per frame.
type InputStates = Rc<RefCell<HashMap<ElementId, Rc<RefCell<InputState>>>>>;

/// Which axes scroll for the `overflow` style key. Closed set — single source
/// of truth so the renderer and the protocol docs agree (AGENTS invariant 1).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ScrollAxis {
    X,
    Y,
    Both,
}

/// Parse the `overflow` style value into scroll axes; unknown values are
/// ignored (style keys are forward-compatible).
fn parse_overflow(value: &StyleValue) -> Option<ScrollAxis> {
    match value.as_str() {
        Some("scroll") => Some(ScrollAxis::Both),
        Some("scrollX") => Some(ScrollAxis::X),
        Some("scrollY") => Some(ScrollAxis::Y),
        _ => None,
    }
}

/// Live editable state of one input/textarea element. The retained node's
/// `value` is the controlled mirror pushed by JS; this is what the platform
/// IME edits between setValue pushes (native caret/undo live here).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct InputState {
    pub value: String,
    /// Caret position in UTF-16 code units (NSTextInputClient's unit).
    pub caret: usize,
    /// IME composing (marked) range in UTF-16 code units, if active.
    pub marked: Option<Range<usize>>,
}

impl InputState {
    pub fn with_value(value: String) -> Self {
        let caret = utf16_len(&value);
        InputState {
            value,
            caret,
            marked: None,
        }
    }
}

/// UTF-16 code-unit length of a string (the platform text client's unit).
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Byte offset for a UTF-16 code-unit offset, clamped to the end.
fn utf16_byte_index(s: &str, utf16: usize) -> usize {
    let mut units = 0usize;
    for (byte, c) in s.char_indices() {
        if units >= utf16 {
            return byte;
        }
        units += c.len_utf16();
    }
    s.len()
}

/// Replace `[start, end)` given in UTF-16 code units with `replacement`.
/// Pure — unit-tested against astral characters (emoji = 2 units).
fn edit_utf16(s: &str, range: Range<usize>, replacement: &str) -> String {
    let len = utf16_len(s);
    let start = utf16_byte_index(s, range.start.min(len));
    let end = utf16_byte_index(s, range.end.min(len));
    if start > end {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + replacement.len());
    out.push_str(&s[..start]);
    out.push_str(replacement);
    out.push_str(&s[end..]);
    out
}

/// UTF-16 substring for `text_for_range`.
fn utf16_substring(s: &str, range: Range<usize>) -> String {
    let units: Vec<u16> = s
        .encode_utf16()
        .skip(range.start)
        .take(range.end.saturating_sub(range.start))
        .collect();
    String::from_utf16(&units).unwrap_or_default()
}

/// Write one event line to stdout under the process-global lock (the stdin
/// thread uses the same lock, scoped per write — deadlock invariant).
fn write_event_line(event: &Event) {
    let line = solid_gpui_protocol::event_to_json(event);
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

/// Apply a UTF-16 edit to an input's shared state and emit a `change` event
/// carrying the new value (the helper→JS direction of controlled sync).
/// Shared by the platform InputHandler, the Enter-newline path, and the
/// simulateInput command so every edit crosses the wire identically.
/// Returns the new value; the caller is responsible for repainting.
fn edit_input(
    state: &Rc<RefCell<InputState>>,
    id: ElementId,
    range: Option<Range<usize>>,
    text: &str,
    sink: &Rc<dyn Fn(&Event)>,
) -> String {
    let new_value = {
        let mut s = state.borrow_mut();
        let len = utf16_len(&s.value);
        let sel = range.unwrap_or(s.caret..s.caret);
        let start = sel.start.min(len).min(sel.end.min(len));
        let end = sel.end.min(len).max(start);
        s.value = edit_utf16(&s.value, start..end, text);
        s.caret = start + utf16_len(text);
        s.marked = None;
        s.value.clone()
    };
    sink(&Event::Input {
        id,
        event_type: EventType::Change,
        x: None,
        y: None,
        key: None,
        modifiers: None,
        value: Some(new_value.clone()),
    });
    new_value
}

pub struct HostView {
    pub tree: RetainedTree,
    /// Build-time samples for the debug overlay and the getStats command.
    stats: FrameStats,
    /// SOLID_GPUI_DEBUG_OVERLAY=1 paints frame stats into the window.
    overlay: bool,
    scroll_handles: ScrollHandles,
    focus_handles: FocusHandles,
    /// Keeps cx.on_focus_in/out subscriptions alive for the view's lifetime.
    focus_subscriptions: Vec<gpui::Subscription>,
    /// Ids that already registered focus subscriptions. Rendering runs every
    /// frame; without this, each render would register a fresh subscription
    /// and one focus change would emit N duplicate events (observed 3x).
    focus_subscribed: HashSet<ElementId>,
    /// autoFocus target waiting for the next frame: focused via defer_in so
    /// the focus subscription (activated one frame later by gpui) is live
    /// when the focus happens — otherwise the focus event is silently missed.
    autofocus_pending: Option<ElementId>,
    /// Live editable state per input/textarea element. Shared with the per-
    /// frame platform InputHandler so edits persist across frames (the
    /// handler itself is rebuilt every frame by the IME anchor).
    input_states: InputStates,
    /// Writes one event line to stdout; handed to the InputHandler so a
    /// user edit can cross the wire without a HostView borrow.
    sink: Rc<dyn Fn(&Event)>,
    /// Virtualized list state per list element (gpui ListState is Rc<RefCell>
    /// internally and Clone). Created at apply time so followTail alignment is
    /// known before the first paint; reconciled to the retained children count
    /// every render.
    list_states: HashMap<ElementId, ListState>,
    /// Per-list count of items actually painted last frame — virtualization
    /// proof for listInfo (10k retained items must paint far fewer).
    list_render_counts: HashMap<ElementId, Rc<std::cell::Cell<usize>>>,
    /// Alignment each list state was created with (see RenderCtx).
    list_alignment: HashMap<ElementId, ListAlignment>,
    /// Lists that already had FollowMode::Tail armed (see RenderCtx).
    list_follow_armed: HashSet<ElementId>,
}

impl HostView {
    pub fn new() -> Self {
        HostView {
            tree: RetainedTree::new(),
            stats: FrameStats::new(),
            overlay: std::env::var("SOLID_GPUI_DEBUG_OVERLAY").is_ok_and(|v| v == "1"),
            scroll_handles: Rc::new(RefCell::new(HashMap::new())),
            focus_handles: Rc::new(RefCell::new(HashMap::new())),
            focus_subscriptions: Vec::new(),
            focus_subscribed: HashSet::new(),
            autofocus_pending: None,
            input_states: Rc::new(RefCell::new(HashMap::new())),
            sink: Rc::new(write_event_line),
            list_states: HashMap::new(),
            list_render_counts: HashMap::new(),
            list_alignment: HashMap::new(),
            list_follow_armed: HashSet::new(),
        }
    }

    /// Wire payload for the S7b getStats command. Durations are milliseconds
    /// rounded to microseconds; percentiles describe the retained-walk build
    /// cost over the current ring window.
    pub fn stats_value(&self) -> serde_json::Value {
        let ms = |d: Option<std::time::Duration>| match d {
            Some(d) => serde_json::json!((d.as_secs_f64() * 1_000_000.0).round() / 1000.0),
            None => serde_json::Value::Null,
        };
        serde_json::json!({
            "frames": self.stats.frames(),
            "samples": self.stats.len(),
            "p50Ms": ms(self.stats.percentile(0.5)),
            "p90Ms": ms(self.stats.percentile(0.90)),
            "p95Ms": ms(self.stats.percentile(0.95)),
            "maxMs": ms(self.stats.max()),
            "lastMs": ms(self.stats.last()),
        })
    }

    /// Eagerly materialize a scroll handle when a setStyle declares an
    /// overflow scroll value — scrollTo must work before the first paint, and
    /// the map is otherwise populated lazily during render. Idempotent with
    /// the render-time get-or-create.
    pub fn ensure_scroll_handle(&self, id: ElementId) {
        let scrollable = self
            .tree
            .get(id)
            .is_some_and(|n| n.style.get("overflow").and_then(parse_overflow).is_some());
        if scrollable {
            self.scroll_handles.borrow_mut().entry(id).or_default();
        }
    }

    /// S8b scrollTo: move a scrollable element's retained offset. Fails when
    /// the id never rendered with an `overflow` scroll style (no handle).
    ///
    /// Wire convention: x/y are non-negative absolute positions (0 = top /
    /// left), positive = scrolled down/right. gpui's internal convention is
    /// inverted — `set_offset` takes the distance from the container's top
    /// left to the first child's top left, which grows more NEGATIVE as you
    /// scroll down (and layout clamps to [-max, 0]). Negate on the way in,
    /// negate on the way out, and the wire stays CSS-scrollTop-like.
    pub fn scroll_to(&self, id: ElementId, x: f64, y: f64) -> Result<(), String> {
        let handles = self.scroll_handles.borrow();
        let Some(handle) = handles.get(&id) else {
            return Err(format!(
                "no scrollable element for id {}; set overflow=scroll on it first",
                id.0
            ));
        };
        handle.set_offset(Point::new(px(-(x as f32)), px(-(y as f32))));
        Ok(())
    }

    /// S8b getScrollOffset: read a scrollable element's CURRENT visible
    /// position (clamped to the real content size), in wire convention
    /// (non-negative, positive = scrolled down/right). Clamping against
    /// `max_offset` matters: a scrollTo past the content would otherwise
    /// report a position the layout refuses to show.
    pub fn scroll_offset(&self, id: ElementId) -> Option<(f64, f64)> {
        let handles = self.scroll_handles.borrow();
        let handle = handles.get(&id)?;
        let off = handle.offset();
        let max = handle.max_offset();
        let x = (-off.x).clamp(px(0.), max.x.max(px(0.)));
        let y = (-off.y).clamp(px(0.), max.y.max(px(0.)));
        Some((x.to_f64(), y.to_f64()))
    }

    /// Eagerly materialize a focus handle when a setStyle/setEventListener
    /// makes a node focusable — focusElement must work before the first paint
    /// (render-population is lazy). Creates through the app focus map so Tab
    /// navigation sees it. Idempotent with the render-time get-or-create.
    pub fn ensure_focus_handle(&self, id: ElementId, cx: &mut gpui::App) {
        let wants_focus = self.tree.get(id).is_some_and(|n| {
            n.style.contains_key("tabIndex")
                || n.style.contains_key("autoFocus")
                || n.listeners.contains(&EventType::Focus)
                || n.listeners.contains(&EventType::Blur)
                || n.listeners.contains(&EventType::KeyDown)
                || n.listeners.contains(&EventType::KeyUp)
        });
        if wants_focus {
            self.focus_handles
                .borrow_mut()
                .entry(id)
                .or_insert_with(|| cx.focus_handle());
        }
    }

    /// Record the autoFocus target; render() focuses it via a deferred
    /// callback so the focus event is not missed (see autofocus_pending).
    pub fn mark_autofocus(&mut self, id: ElementId) {
        self.autofocus_pending.get_or_insert(id);
    }

    /// Set an input's value from the wire (setValue — the JS→helper direction
    /// of controlled sync). Overwrites internal edits and moves the caret to
    /// the end, exactly like a controlled React input re-render.
    pub fn set_input_value(&self, id: ElementId, value: &str) {
        let mut map = self.input_states.borrow_mut();
        let entry = map
            .entry(id)
            .or_insert_with(|| Rc::new(RefCell::new(InputState::default())));
        let mut s = entry.borrow_mut();
        s.value = value.to_string();
        s.caret = utf16_len(value);
        s.marked = None;
    }

    /// simulateInput command + Enter-newline: apply a text edit at the caret
    /// through the same path as the platform IME (edit_input), emitting a
    /// change event. Fails when the id never rendered as input/textarea.
    pub fn simulate_input(&self, id: ElementId, text: &str) -> Result<(), String> {
        let Some(state) = self.input_states.borrow().get(&id).cloned() else {
            return Err(format!("no input/textarea for id {}", id.0));
        };
        edit_input(&state, id, None, text, &self.sink);
        Ok(())
    }

    /// Insert text at the caret (textarea Enter-newline path from a keydown
    /// listener; no selection support in v1).
    fn insert_text(&self, id: ElementId, text: &str) {
        if let Some(state) = self.input_states.borrow().get(&id).cloned() {
            edit_input(&state, id, None, text, &self.sink);
        }
    }

    /// Push a submit event (input Enter / textarea Shift+Enter).
    fn emit_submit(&self, id: ElementId) {
        self.emit_event(id, EventType::Submit, None, None, None, None, None);
    }

    /// Eagerly materialize a virtual list's state when a list element or its
    /// list styles apply — followTail alignment must be known before the
    /// first paint (render-population is lazy, same pattern as scroll/focus
    /// handles). Idempotent with the render-time get-or-create.
    pub fn ensure_list_state(&mut self, id: ElementId) {
        let Some(node) = self.tree.get(id) else {
            return;
        };
        if node.element_type != ElementType::List {
            return;
        }
        let follow_tail = node.style.contains_key("followTail");
        let alignment = if follow_tail {
            ListAlignment::Bottom
        } else {
            ListAlignment::Top
        };
        if self.list_alignment.get(&id) != Some(&alignment) {
            // ListState bakes alignment at construction: recreate when the
            // followTail flag toggles (only meaningful before first paint).
            self.list_states
                .insert(id, ListState::new(0, alignment, px(500.)));
            self.list_alignment.insert(id, alignment);
            self.list_follow_armed.remove(&id);
        }
        if follow_tail
            && self.list_follow_armed.insert(id)
            && let Some(state) = self.list_states.get(&id)
        {
            state.set_follow_mode(FollowMode::Tail);
        }
    }

    /// S11 listInfo: item count, items painted last frame (virtualization
    /// proof), and whether the list is scrolled to its end (followTail chat
    /// position). Fails when the id never rendered as a list.
    pub fn list_info(&self, id: ElementId) -> Result<serde_json::Value, String> {
        let Some(state) = self.list_states.get(&id) else {
            return Err(format!("no list element for id {}", id.0));
        };
        let painted = self
            .list_render_counts
            .get(&id)
            .map(|c| c.get())
            .unwrap_or(0);
        let at_end = state.is_scrolled_to_end();
        Ok(serde_json::json!({
            "itemCount": state.item_count(),
            "paintedCount": painted,
            "atEnd": at_end,
        }))
    }

    /// S9: programmatic focus for the focusElement command. Fails when the
    /// id was never rendered focusable (no FocusHandle).
    pub fn focus_element(
        &self,
        id: ElementId,
        window: &mut Window,
        cx: &mut gpui::App,
    ) -> Result<(), String> {
        let handles = self.focus_handles.borrow();
        let Some(handle) = handles.get(&id) else {
            return Err(format!(
                "no focusable element for id {}; set tabIndex on it first",
                id.0
            ));
        };
        handle.focus(window, cx);
        Ok(())
    }

    /// Push one event line to the JS side. The process-global stdout lock
    /// serializes this with the stdin thread's writes (deadlock invariant).
    #[allow(clippy::too_many_arguments)]
    fn emit_event(
        &self,
        id: ElementId,
        event_type: EventType,
        x: Option<f64>,
        y: Option<f64>,
        key: Option<String>,
        modifiers: Option<solid_gpui_protocol::Modifiers>,
        value: Option<String>,
    ) {
        write_event_line(&Event::Input {
            id,
            event_type,
            x,
            y,
            key,
            modifiers,
            value,
        });
    }

    /// Push a click event to the JS side as one NDJSON line.
    fn emit_click(&self, id: ElementId, event: &gpui::ClickEvent) {
        let (x, y) = match event {
            gpui::ClickEvent::Mouse(m) => (
                Some(m.up.position.x.to_f64()),
                Some(m.up.position.y.to_f64()),
            ),
            _ => (None, None),
        };
        self.emit_event(id, EventType::Click, x, y, None, None, None);
    }

    /// Push a focus/blur event to the JS side.
    fn emit_focus(&self, id: ElementId, focused: bool) {
        let event_type = if focused {
            EventType::Focus
        } else {
            EventType::Blur
        };
        self.emit_event(id, event_type, None, None, None, None, None);
    }

    /// Push a keyDown event to the JS side (keystroke key + modifiers).
    fn emit_key(&self, id: ElementId, event: &gpui::KeyDownEvent) {
        let line = solid_gpui_protocol::event_to_json(&key_event(
            id,
            EventType::KeyDown,
            &event.keystroke,
        ));
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }

    /// Push a keyUp event to the JS side.
    fn emit_key_up(&self, id: ElementId, event: &gpui::KeyUpEvent) {
        let line =
            solid_gpui_protocol::event_to_json(&key_event(id, EventType::KeyUp, &event.keystroke));
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}

/// Map a gpui keystroke to the wire event (pure — unit-tested modifier map).
fn key_event(id: ElementId, event_type: EventType, keystroke: &gpui::Keystroke) -> Event {
    Event::Input {
        id,
        event_type,
        x: None,
        y: None,
        key: Some(keystroke.key.clone()),
        modifiers: Some(solid_gpui_protocol::Modifiers {
            ctrl: keystroke.modifiers.control,
            alt: keystroke.modifiers.alt,
            shift: keystroke.modifiers.shift,
            cmd: keystroke.modifiers.platform,
        }),
        value: None,
    }
}

/// Shared render-time context threaded through build_element: the handle
/// maps (scroll/focus/input), focus subscription bookkeeping, the event sink
/// and the owning view handle (for repaint requests after IME edits).
struct RenderCtx<'a> {
    scroll_handles: &'a ScrollHandles,
    focus_handles: &'a FocusHandles,
    input_states: &'a InputStates,
    subscriptions: &'a mut Vec<gpui::Subscription>,
    subscribed: &'a mut HashSet<ElementId>,
    sink: &'a Rc<dyn Fn(&Event)>,
    host: &'a WeakEntity<HostView>,
    list_states: &'a mut HashMap<ElementId, ListState>,
    list_render_counts: &'a mut HashMap<ElementId, Rc<std::cell::Cell<usize>>>,
    /// Alignment each list state was created with (ListState bakes alignment
    /// at construction; recreate when followTail toggles).
    list_alignment: &'a mut HashMap<ElementId, ListAlignment>,
    /// Lists that already had FollowMode::Tail armed. set_follow_mode resets
    /// the scroll position to the end every call, so it must run ONCE — a
    /// per-render call would fight the user's manual scroll-up.
    list_follow_armed: &'a mut HashSet<ElementId>,
}

/// The per-frame gpui InputHandler registered for a focused input/textarea.
/// Rebuilt every frame by the IME anchor's paint; holds clones of the shared
/// state + sink + view handle so edits persist across frames and cross the
/// wire without a HostView borrow.
#[derive(Clone)]
struct InputHandlerState {
    id: ElementId,
    state: Rc<RefCell<InputState>>,
    sink: Rc<dyn Fn(&Event)>,
    host: WeakEntity<HostView>,
}

impl InputHandlerState {
    /// Request a repaint so the caret/text update even when JS never echoes
    /// the change back (uncontrolled inputs).
    fn repaint(&self, cx: &mut App) {
        if self.host.upgrade().is_some() {
            cx.notify(self.host.entity_id());
        }
    }
}

impl InputHandler for InputHandlerState {
    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Option<UTF16Selection> {
        let s = self.state.borrow();
        Some(UTF16Selection {
            range: s.caret..s.caret,
            reversed: false,
        })
    }

    fn marked_text_range(&mut self, _window: &mut Window, _cx: &mut App) -> Option<Range<usize>> {
        self.state.borrow().marked.clone()
    }

    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        _adjusted: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Option<String> {
        let s = self.state.borrow();
        Some(utf16_substring(&s.value, range_utf16))
    }

    fn replace_text_in_range(
        &mut self,
        replacement_range: Option<Range<usize>>,
        text: &str,
        _window: &mut Window,
        cx: &mut App,
    ) {
        edit_input(&self.state, self.id, replacement_range, text, &self.sink);
        self.repaint(cx);
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        new_selected_range: Option<Range<usize>>,
        _window: &mut Window,
        cx: &mut App,
    ) {
        let new_value = {
            let mut s = self.state.borrow_mut();
            let len = utf16_len(&s.value);
            let sel = range_utf16.unwrap_or(s.caret..s.caret);
            let start = sel.start.min(len).min(sel.end.min(len));
            let end = sel.end.min(len).max(start);
            s.value = edit_utf16(&s.value, start..end, new_text);
            let composed_end = start + utf16_len(new_text);
            s.caret = new_selected_range.map(|ns| ns.end).unwrap_or(composed_end);
            s.marked = Some(start..composed_end);
            s.value.clone()
        };
        (self.sink)(&Event::Input {
            id: self.id,
            event_type: EventType::Change,
            x: None,
            y: None,
            key: None,
            modifiers: None,
            value: Some(new_value),
        });
        self.repaint(cx);
    }

    fn unmark_text(&mut self, _window: &mut Window, _cx: &mut App) {
        self.state.borrow_mut().marked = None;
    }

    fn bounds_for_range(
        &mut self,
        _range_utf16: Range<usize>,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Option<Bounds<Pixels>> {
        // No native IME candidate-window positioning in v1; composing text
        // renders inline. None keeps the platform candidate window hidden.
        None
    }

    fn character_index_for_point(
        &mut self,
        _point: Point<Pixels>,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Option<usize> {
        None
    }
}

/// Invisible zero-size element whose paint registers the platform input
/// handler (`window.handle_input`) for a focused input/textarea. Sits inside
/// the input's div so the div keeps all focus/tab/click/key machinery; only
/// IME routing needs the paint phase (render is not paint).
#[derive(Clone)]
struct ImeAnchor {
    focus_handle: FocusHandle,
    handler: InputHandlerState,
}

impl Element for ImeAnchor {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<gpui::ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let style = Style {
            size: size(px(0.).into(), px(0.).into()),
            ..Default::default()
        };
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        window.set_focus_handle(&self.focus_handle, cx);
    }

    fn paint(
        &mut self,
        _: Option<&gpui::GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        window.handle_input(&self.focus_handle, self.handler.clone(), cx);
    }
}

impl IntoElement for ImeAnchor {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

/// Numeric style value for a key, if present (fontSize, minRows, ...).
fn style_num(style: &StyleMap, key: &str) -> Option<f64> {
    match style.get(key) {
        Some(StyleValue::Number(n)) => n.as_f64(),
        _ => None,
    }
}

impl Render for HostView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let started = std::time::Instant::now();
        // Drop handles for ids the tree no longer holds (destroyed/moved).
        // Clone the Rc first so the retain closure can borrow `self.tree`
        // while the RefCell is borrowed (disjoint fields via one borrow).
        let handles = self.scroll_handles.clone();
        handles
            .borrow_mut()
            .retain(|id, _| self.tree.get(*id).is_some());
        let focus = self.focus_handles.clone();
        focus
            .borrow_mut()
            .retain(|id, _| self.tree.get(*id).is_some());
        let inputs = self.input_states.clone();
        inputs
            .borrow_mut()
            .retain(|id, _| self.tree.get(*id).is_some());
        let host = cx.entity().downgrade();
        // Reset the virtualization counters: build_element's list items
        // increment them during layout, after this render call returns.
        for counter in self.list_render_counts.values() {
            counter.set(0);
        }
        let mut ctx = RenderCtx {
            scroll_handles: &self.scroll_handles,
            focus_handles: &self.focus_handles,
            input_states: &self.input_states,
            subscriptions: &mut self.focus_subscriptions,
            subscribed: &mut self.focus_subscribed,
            sink: &self.sink,
            host: &host,
            list_states: &mut self.list_states,
            list_render_counts: &mut self.list_render_counts,
            list_alignment: &mut self.list_alignment,
            list_follow_armed: &mut self.list_follow_armed,
        };
        let mut content = match self.tree.root() {
            Some(root) => build_element(&self.tree, root, window, cx, &mut ctx),
            // No root yet: dark placeholder keeps the window alive pre-mount.
            None => div().size_full().bg(rgb(0x1e1e2e)).into_any_element(),
        };
        self.stats.push(started.elapsed());

        // Focus the autoFocus target after this frame's deferred callbacks:
        // the on_focus_in subscription (registered during build_element,
        // activated via defer) must be live before handle.focus so the focus
        // event reaches JS.
        if let Some(id) = self.autofocus_pending.take() {
            cx.defer_in(window, move |view, window, cx| {
                if let Some(handle) = view.focus_handles.borrow().get(&id).cloned() {
                    handle.focus(window, cx);
                }
            });
        }

        if !self.overlay {
            return content;
        }
        // Overlay: bottom-left stat block painted with native styling — not a
        // protocol element, so it never crosses the wire. Shows the retained-
        // walk build cost (our architecture's number), not layout/paint.
        let p95 = self
            .stats
            .percentile(0.95)
            .map(|d| format!("{:.1}", d.as_secs_f64() * 1000.0))
            .unwrap_or_else(|| "-".into());
        let last = self
            .stats
            .last()
            .map(|d| format!("{:.1}", d.as_secs_f64() * 1000.0))
            .unwrap_or_else(|| "-".into());
        let label = SharedString::from(format!(
            "build {}ms | p95 {}ms | frames {}",
            last,
            p95,
            self.stats.frames()
        ));
        content = div()
            .size_full()
            .child(content)
            .child(
                div()
                    .absolute()
                    .bottom_2()
                    .left_2()
                    .px_2()
                    .py_1()
                    .rounded_sm()
                    .bg(rgb(0x11111b))
                    .text_color(rgb(0xa6e3a1))
                    .text_size(px(11.))
                    .child(label),
            )
            .into_any_element();
        content
    }
}

/// Map one retained node to a GPUI element. Unknown style keys/values are
/// ignored (forward compatibility — see protocol StyleMap docs). Text nodes
/// render as plain GPUI text children; input/textarea get the dedicated
/// builder (text + caret + IME anchor).
fn build_element(
    tree: &RetainedTree,
    id: ElementId,
    window: &mut Window,
    cx: &mut Context<HostView>,
    ctx: &mut RenderCtx,
) -> AnyElement {
    let Some(node) = tree.get(id) else {
        return div().into_any_element();
    };
    if node.element_type == ElementType::Text {
        return SharedString::from(node.text.clone().unwrap_or_default()).into_any_element();
    }
    if matches!(
        node.element_type,
        ElementType::Input | ElementType::Textarea
    ) {
        return build_input_element(tree, id, window, cx, ctx);
    }
    if node.element_type == ElementType::List {
        return build_list_element(tree, id, window, cx, ctx);
    }
    let mut el = div();
    for (key, value) in &node.style {
        el = apply_style(el, key, value);
    }
    for child in &node.children {
        el = el.child(build_element(tree, *child, window, cx, ctx));
    }

    let axis = node.style.get("overflow").and_then(parse_overflow);
    let has_click = node.listeners.contains(&EventType::Click);
    let has_focus =
        node.listeners.contains(&EventType::Focus) || node.listeners.contains(&EventType::Blur);
    let has_key =
        node.listeners.contains(&EventType::KeyDown) || node.listeners.contains(&EventType::KeyUp);
    // tabIndex: -1 focusable but not a tab stop, 0/positive = tab stop.
    let tab_index: Option<isize> = match node.style.get("tabIndex") {
        Some(StyleValue::Number(n)) => n.as_f64().map(|f| f as isize),
        _ => None,
    };
    let has_autofocus = node.style.contains_key("autoFocus");
    let wants_focus = tab_index.is_some() || has_focus || has_key || has_autofocus;
    if axis.is_none() && !has_click && !wants_focus {
        return el.into_any_element();
    }

    let el = el.id(id.0 as usize);
    let el = apply_interactive(el, tree, id, window, cx, ctx, tab_index, false);
    el.into_any_element()
}

/// Wire interactive behavior (scroll handles, focus subscriptions, Tab
/// navigation, user key handlers, click) onto a stateful element. Shared by
/// generic elements and inputs; `force_focus` makes inputs focusable (natural
/// tab stops) even without an explicit tabIndex.
#[allow(clippy::too_many_arguments)]
fn apply_interactive(
    mut el: gpui::Stateful<Div>,
    tree: &RetainedTree,
    id: ElementId,
    window: &mut Window,
    cx: &mut Context<HostView>,
    ctx: &mut RenderCtx,
    tab_index: Option<isize>,
    force_focus: bool,
) -> gpui::Stateful<Div> {
    let node = tree.get(id).unwrap();
    let axis = node.style.get("overflow").and_then(parse_overflow);
    let has_click = node.listeners.contains(&EventType::Click);
    let has_focus =
        node.listeners.contains(&EventType::Focus) || node.listeners.contains(&EventType::Blur);
    let has_key =
        node.listeners.contains(&EventType::KeyDown) || node.listeners.contains(&EventType::KeyUp);
    let has_autofocus = node.style.contains_key("autoFocus");
    let wants_focus = force_focus || tab_index.is_some() || has_focus || has_key || has_autofocus;

    if let Some(axis) = axis {
        let handle = ctx
            .scroll_handles
            .borrow_mut()
            .entry(id)
            .or_default()
            .clone();
        el = el.track_scroll(&handle);
        el = match axis {
            ScrollAxis::X => el.overflow_x_scroll(),
            ScrollAxis::Y => el.overflow_y_scroll(),
            ScrollAxis::Both => el.overflow_scroll(),
        };
    }
    if wants_focus {
        // FocusHandle is cloneable and shared; tab config is applied per
        // render so style changes to tabIndex re-apply on the same handle.
        // No Default impl: create through the app's focus map (Context derefs
        // to App), which also tracks the handle for window.focus_next/prev.
        let handle = ctx
            .focus_handles
            .borrow_mut()
            .entry(id)
            .or_insert_with(|| cx.focus_handle())
            .clone();
        // Inputs: default natural-order tab stop; explicit tabIndex overrides.
        let configured = if force_focus && tab_index.is_none() {
            handle.clone().tab_stop(true)
        } else {
            match tab_index {
                None | Some(-1) => handle.clone().tab_stop(false),
                Some(n) => handle.clone().tab_stop(true).tab_index(n),
            }
        };
        el = el.focusable().track_focus(&configured);
        if has_focus && ctx.subscribed.insert(id) {
            // Focus/blur subscriptions must outlive this render call, and
            // register exactly once per element (render runs every frame).
            // Note: activation is deferred one frame by gpui, so focus events
            // for a focus issued in the same frame as the first render can be
            // missed — callers should wait a frame after mount before
            // expecting focus events (documented in the window test).
            let sub_in = cx.on_focus_in(&handle, window, move |view, _window, _cx| {
                view.emit_focus(id, true);
            });
            let sub_out = cx.on_focus_out(&handle, window, move |view, _event, _window, _cx| {
                view.emit_focus(id, false);
            });
            ctx.subscriptions.push(sub_in);
            ctx.subscriptions.push(sub_out);
        }
        // Tab navigates focus Rust-side (no IPC roundtrip per key). Handled
        // on every focusable element because gpui only delivers keys to the
        // focused element and window.on_key_event requires the paint phase.
        let tab_listener = cx.listener(move |_view, event: &gpui::KeyDownEvent, window, cx| {
            if event.keystroke.key == "tab" {
                if event.keystroke.modifiers.shift {
                    window.focus_prev(cx);
                } else {
                    window.focus_next(cx);
                }
            }
        });
        el = el.on_key_down(tab_listener);
        if has_key {
            let listener = cx.listener(move |view, event: &gpui::KeyDownEvent, _window, _cx| {
                view.emit_key(id, event);
            });
            el = el.on_key_down(listener);
            let listener = cx.listener(move |view, event: &gpui::KeyUpEvent, _window, _cx| {
                view.emit_key_up(id, event);
            });
            el = el.on_key_up(listener);
        }
    }
    if has_click {
        let listener = cx.listener(move |view, event: &gpui::ClickEvent, _window, _cx| {
            view.emit_click(id, event);
        });
        el = el.on_click(listener);
    }
    el
}

/// Build one input/textarea element: a styled div (generic styles + full
/// interactive wiring) containing the value/placeholder text, an in-flow
/// caret, and the IME anchor that routes native text input to the shared
/// InputState. Enter semantics differ: input Enter → submit, textarea Enter →
/// newline (Shift+Enter → submit). Textarea autosizes rows to the value,
/// clamped to minRows/maxRows.
#[allow(clippy::too_many_arguments)]
fn build_input_element(
    tree: &RetainedTree,
    id: ElementId,
    window: &mut Window,
    cx: &mut Context<HostView>,
    ctx: &mut RenderCtx,
) -> AnyElement {
    let node = tree.get(id).expect("checked by caller");
    let multiline = node.element_type == ElementType::Textarea;

    // Shared editable state (get-or-create mirroring the wire value).
    let state = ctx
        .input_states
        .borrow_mut()
        .entry(id)
        .or_insert_with(|| {
            Rc::new(RefCell::new(InputState::with_value(
                node.value.clone().unwrap_or_default(),
            )))
        })
        .clone();
    let value = state.borrow().value.clone();
    let focused = ctx
        .focus_handles
        .borrow()
        .get(&id)
        .is_some_and(|h| h.is_focused(window));
    let font_size = style_num(&node.style, "fontSize").unwrap_or(16.0) as f32;

    let placeholder = node
        .style
        .get("placeholder")
        .and_then(StyleValue::as_str)
        .unwrap_or_default()
        .to_string();
    let display = if value.is_empty() {
        placeholder
    } else {
        value.clone()
    };

    let mut el = div();
    for (key, value) in &node.style {
        el = apply_style(el, key, value);
    }
    // Textarea autosize: rows = line count clamped to [minRows, maxRows],
    // height = rows * line height + vertical padding. v1 measures the logical
    // line count, not wrapped lines (no reflow-aware measurement).
    if multiline {
        let min_rows = style_num(&node.style, "minRows").unwrap_or(1.0).max(1.0) as usize;
        let max_rows = style_num(&node.style, "maxRows")
            .map(|n| n.max(1.0) as usize)
            .unwrap_or(8);
        let lines = value.lines().count().max(1);
        let rows = lines.clamp(min_rows, max_rows);
        let line_height = font_size * 1.4;
        let vpad = style_num(&node.style, "padding").unwrap_or(4.0) as f32 * 2.0;
        el = el.h(px(rows as f32 * line_height + vpad));
    }
    el = el.flex().items_center();
    if multiline {
        el = el.flex_col().items_start();
    }

    // Value (or placeholder) text + in-flow caret (v1: caret at the end of
    // the current value; no selection/caret-at-point rendering).
    el = el.child(SharedString::from(display));
    if focused && !multiline {
        el = el.child(div().w(px(1.5)).h(px(font_size * 1.2)).bg(rgb(0xeeeeee)));
    }
    // The IME anchor routes native text input (IME composing, caret, undo)
    // into the shared state. Only one input can be focused, so at most one
    // anchor registers a handler per frame.
    if let Some(handle) = ctx.focus_handles.borrow().get(&id).cloned() {
        el = el.child(ImeAnchor {
            focus_handle: handle,
            handler: InputHandlerState {
                id,
                state,
                sink: ctx.sink.clone(),
                host: ctx.host.clone(),
            },
        });
    }

    let tab_index: Option<isize> = match node.style.get("tabIndex") {
        Some(StyleValue::Number(n)) => n.as_f64().map(|f| f as isize),
        _ => None,
    };
    let el = el.id(id.0 as usize);
    let mut el = apply_interactive(el, tree, id, window, cx, ctx, tab_index, true);
    // Enter semantics (Rust-side, no IPC roundtrip): single-line submits,
    // multiline inserts a newline unless Shift is held.
    let enter = cx.listener(move |view, event: &gpui::KeyDownEvent, _window, _cx| {
        if event.keystroke.key != "enter" {
            return;
        }
        if multiline {
            if event.keystroke.modifiers.shift {
                view.emit_submit(id);
            } else {
                view.insert_text(id, "\n");
            }
        } else {
            view.emit_submit(id);
        }
    });
    el = el.on_key_down(enter);
    el.into_any_element()
}

/// Build a virtual list element: gpui's List over the retained children.
/// The retained tree holds EVERY item (retain-all); the List paints only the
/// visible subset (paint-visible) — its State measures lazily and renders
/// items on demand. followTail → Bottom alignment + FollowMode::Tail (chat
/// auto-scroll; stops on manual scroll up, re-engages at the bottom).
/// itemHeight seeds every unmeasured item so the scrollbar is correct from
/// the first frame (real heights replace the hint as items render).
///
/// render_item re-enters the view via Entity::update to build items with
/// full interactive wiring (clicks/focus work inside lists).
fn build_list_element(
    tree: &RetainedTree,
    id: ElementId,
    window: &mut Window,
    cx: &mut Context<HostView>,
    ctx: &mut RenderCtx,
) -> AnyElement {
    let node = tree.get(id).expect("checked by caller");
    let item_height = style_num(&node.style, "itemHeight").map(|n| px(n as f32));
    let entity = cx.entity();
    let host_weak = entity.downgrade();
    let counter = ctx
        .list_render_counts
        .entry(id)
        .or_insert_with(|| Rc::new(std::cell::Cell::new(0)))
        .clone();

    // Reconcile alignment (recreate on toggle — see ensure_list_state),
    // then the state to the retained children count (append/remove splice;
    // insertBefore mid-list splices the whole range — v1 keeps item identity
    // by index, documented simplification).
    let follow_tail = node.style.contains_key("followTail");
    let alignment = if follow_tail {
        ListAlignment::Bottom
    } else {
        ListAlignment::Top
    };
    if ctx.list_alignment.get(&id) != Some(&alignment) {
        ctx.list_states
            .insert(id, ListState::new(0, alignment, px(500.)));
        ctx.list_alignment.insert(id, alignment);
        ctx.list_follow_armed.remove(&id);
    }
    let state = ctx
        .list_states
        .entry(id)
        .or_insert_with(|| ListState::new(0, alignment, px(500.)))
        .clone();
    let old_count = state.item_count();
    let new_count = node.children.len();
    if old_count != new_count {
        state.splice(0..old_count, new_count);
    }
    let state = match item_height {
        Some(h) => state.with_uniform_item_height(h),
        None => state,
    };
    if follow_tail && ctx.list_follow_armed.insert(id) {
        state.set_follow_mode(FollowMode::Tail);
    }

    let list_id = id;
    let state_el = state.clone();
    let render_item = move |ix: usize, window: &mut Window, cx: &mut App| {
        counter.set(counter.get() + 1);
        entity.update(cx, |view, vcx| {
            let child = view
                .tree
                .get(list_id)
                .and_then(|n| n.children.get(ix).copied());
            let Some(cid) = child else {
                return div().into_any_element();
            };
            let host = host_weak.clone();
            let mut ctx = RenderCtx {
                scroll_handles: &view.scroll_handles,
                focus_handles: &view.focus_handles,
                input_states: &view.input_states,
                subscriptions: &mut view.focus_subscriptions,
                subscribed: &mut view.focus_subscribed,
                sink: &view.sink,
                host: &host,
                list_states: &mut view.list_states,
                list_render_counts: &mut view.list_render_counts,
                list_alignment: &mut view.list_alignment,
                list_follow_armed: &mut view.list_follow_armed,
            };
            build_element(&view.tree, cid, window, vcx, &mut ctx)
        })
    };
    // Block children take their measured content height (the List would
    // measure all items and never virtualize); a flex ROW stretches the
    // List's cross axis (height) to the container's definite height.
    // gpui divs default to BLOCK: a block child takes its measured content
    // height, so the List would measure all items and never virtualize. A
    // flex ROW stretches the List's cross axis (height) to the container's
    // definite height, so the List only measures the visible subset.
    let mut el = div()
        .w_full()
        .h(px(window.bounds().size.height.into()))
        .flex()
        .child(list(state_el, render_item));
    for (key, value) in &node.style {
        el = apply_style(el, key, value);
    }
    let el = el.id(id.0 as usize);
    let el = apply_interactive(el, tree, id, window, cx, ctx, None, false);
    el.into_any_element()
}

/// v1 style subset; unknown keys and unparsable values are ignored by design.
fn apply_style(mut el: Div, key: &str, value: &StyleValue) -> Div {
    let num = match value {
        StyleValue::Number(n) => n.as_f64(),
        StyleValue::Text(s) => parse_px(s),
    };
    match key {
        "width" => {
            if let Some(n) = num {
                el = el.w(px(n as f32));
            }
        }
        "height" => {
            if let Some(n) = num {
                el = el.h(px(n as f32));
            }
        }
        "minWidth" => {
            if let Some(n) = num {
                el = el.min_w(px(n as f32));
            }
        }
        "minHeight" => {
            if let Some(n) = num {
                el = el.min_h(px(n as f32));
            }
        }
        "padding" => {
            if let Some(n) = num {
                el = el.p(px(n as f32));
            }
        }
        "gap" => {
            if let Some(n) = num {
                el = el.gap(px(n as f32));
            }
        }
        "borderRadius" => {
            if let Some(n) = num {
                el = el.rounded(px(n as f32));
            }
        }
        "fontSize" => {
            if let Some(n) = num {
                el = el.text_size(px(n as f32));
            }
        }
        "flexGrow" => {
            if let Some(n) = num {
                el = el.flex_grow(n as f32);
            }
        }
        "flexShrink" => {
            if let Some(n) = num {
                el = el.flex_shrink(n as f32);
            }
        }
        "opacity" => {
            if let Some(n) = num {
                el = el.opacity(n as f32);
            }
        }
        "display" => {
            if value.as_str() == Some("flex") {
                el = el.flex();
            }
        }
        "flexDirection" => {
            if value.as_str() == Some("column") {
                el = el.flex_col();
            }
        }
        "alignItems" => {
            if value.as_str() == Some("center") {
                el = el.items_center();
            }
        }
        "justifyContent" => {
            if value.as_str() == Some("center") {
                el = el.justify_center();
            }
        }
        // NOTE: `overflow` is intentionally absent here — its scroll behavior
        // needs the stateful element (.overflow_*_scroll lives on
        // Stateful<Div>), so build_element wires it via parse_overflow.
        "cursor" => {
            if value.as_str() == Some("pointer") {
                el = el.cursor_pointer();
            }
        }
        "backgroundColor" => {
            if let Some(c) = parse_color(value) {
                el = el.bg(c);
            }
        }
        "color" => {
            if let Some(c) = parse_color(value) {
                el = el.text_color(c);
            }
        }
        _ => {}
    }
    el
}

/// "N" or "Npx" → N; anything else (multi-value paddings, %, units) → None (v1).
fn parse_px(s: &str) -> Option<f64> {
    let t = s.trim();
    let t = t.strip_suffix("px").unwrap_or(t);
    t.parse::<f64>().ok()
}

fn parse_color(value: &StyleValue) -> Option<Rgba> {
    let h = value.as_str()?.strip_prefix('#')?;
    match h.len() {
        6 => u32::from_str_radix(h, 16).ok().map(rgb),
        8 => u32::from_str_radix(h, 16).ok().map(rgba),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::Rgba;

    #[test]
    fn six_digit_hex_is_opaque_rgb() {
        let c = parse_color(&StyleValue::Text("#1e1e2e".into())).unwrap();
        assert_eq!(
            c,
            Rgba {
                r: 0x1e as f32 / 255.0,
                g: 0x1e as f32 / 255.0,
                b: 0x2e as f32 / 255.0,
                a: 1.0,
            }
        );
    }

    #[test]
    fn eight_digit_hex_honors_alpha_via_rgba() {
        // Regression: rgb() would drop the top byte (#rrggbb→ misrender).
        let c = parse_color(&StyleValue::Text("#ff000080".into())).unwrap();
        assert_eq!(
            c,
            Rgba {
                r: 1.0,
                g: 0.0,
                b: 0.0,
                a: 0x80 as f32 / 255.0,
            }
        );
    }

    #[test]
    fn key_event_maps_modifiers_into_wire_shape() {
        let ks = gpui::Keystroke {
            modifiers: gpui::Modifiers {
                control: true,
                platform: true,
                ..Default::default()
            },
            key: "Enter".into(),
            ..Default::default()
        };
        let event = key_event(ElementId(9), EventType::KeyDown, &ks);
        match &event {
            Event::Input {
                id,
                event_type,
                key,
                modifiers,
                ..
            } => {
                assert_eq!(*id, ElementId(9));
                assert_eq!(*event_type, EventType::KeyDown);
                assert_eq!(key.as_deref(), Some("Enter"));
                let m = modifiers.expect("modifiers present");
                assert!(m.ctrl && m.cmd && !m.alt && !m.shift, "{m:?}");
            }
        }
        // Byte check: ctrl+cmd map to the wire flags, alt/shift stay false.
        let json = solid_gpui_protocol::event_to_json(&event);
        assert_eq!(
            json,
            r#"{"type":"event","id":9,"eventType":"keyDown","key":"Enter","modifiers":{"ctrl":true,"alt":false,"shift":false,"cmd":true}}"#
        );
    }

    #[test]
    fn bad_colors_are_none() {
        assert!(parse_color(&StyleValue::Text("red".into())).is_none());
        assert!(parse_color(&StyleValue::Text("#12345".into())).is_none());
        assert!(parse_color(&StyleValue::Number(5.into())).is_none());
    }

    #[test]
    fn overflow_axis_closed_set() {
        assert_eq!(
            parse_overflow(&StyleValue::Text("scroll".into())),
            Some(ScrollAxis::Both)
        );
        assert_eq!(
            parse_overflow(&StyleValue::Text("scrollX".into())),
            Some(ScrollAxis::X)
        );
        assert_eq!(
            parse_overflow(&StyleValue::Text("scrollY".into())),
            Some(ScrollAxis::Y)
        );
    }

    #[test]
    fn overflow_unknown_values_ignored() {
        assert_eq!(parse_overflow(&StyleValue::Text("auto".into())), None);
        assert_eq!(parse_overflow(&StyleValue::Text("hidden".into())), None);
        assert_eq!(parse_overflow(&StyleValue::Number(1.into())), None);
    }

    #[test]
    fn utf16_len_counts_surrogate_pairs_as_two_units() {
        // Astral characters (emoji) are two UTF-16 code units — the platform
        // text client's unit. A caret "after" an emoji must land at +2.
        assert_eq!(utf16_len(""), 0);
        assert_eq!(utf16_len("ab"), 2);
        assert_eq!(utf16_len("🎉"), 2);
        assert_eq!(utf16_len("a🎉b"), 4);
    }

    #[test]
    fn edit_utf16_replaces_at_caret_past_emoji() {
        // "a🎉b", caret at UTF-16 3 (after the emoji) → insert "X" before "b".
        assert_eq!(edit_utf16("a🎉b", 3..3, "X"), "a🎉Xb");
    }

    #[test]
    fn edit_utf16_replaces_a_selection_in_code_units() {
        // Replace the whole emoji (units 1..3) with "!".
        assert_eq!(edit_utf16("a🎉b", 1..3, "!"), "a!b");
    }

    #[test]
    fn edit_utf16_clamps_out_of_range_offsets() {
        assert_eq!(edit_utf16("ab", 5..9, "z"), "abz");
    }

    #[test]
    fn utf16_substring_returns_code_unit_slice() {
        assert_eq!(utf16_substring("a🎉b", 0..1), "a");
        assert_eq!(utf16_substring("a🎉b", 1..3), "🎉");
        assert_eq!(utf16_substring("a🎉b", 3..4), "b");
    }

    #[test]
    fn edit_input_emits_change_with_new_value_and_moves_caret() {
        let state = Rc::new(RefCell::new(InputState::with_value("hi".into())));
        let events = Rc::new(RefCell::new(Vec::new()));
        let sink: Rc<dyn Fn(&Event)> = {
            let events = events.clone();
            Rc::new(move |e| events.borrow_mut().push(e.clone()))
        };
        let id = ElementId(7);
        let new_value = edit_input(&state, id, None, "🎉", &sink);
        assert_eq!(new_value, "hi🎉");
        let s = state.borrow();
        assert_eq!(s.value, "hi🎉");
        assert_eq!(s.caret, utf16_len("hi🎉"));
        let ev = events.borrow();
        assert_eq!(ev.len(), 1);
        match &ev[0] {
            Event::Input {
                event_type, value, ..
            } => {
                assert_eq!(*event_type, EventType::Change);
                assert_eq!(value.as_deref(), Some("hi🎉"));
            }
        }
    }

    #[test]
    fn controlled_set_value_overwrites_edits_and_resets_caret() {
        // setValue (JS→helper) must replace internal IME edits and move the
        // caret to the end — the controlled-input contract.
        let state = Rc::new(RefCell::new(InputState::with_value("old".into())));
        {
            let mut s = state.borrow_mut();
            s.value = "user typed".into();
            s.caret = 5;
            s.marked = Some(1..3);
        }
        {
            let mut s = state.borrow_mut();
            s.value = "controlled".into();
            s.caret = utf16_len("controlled");
            s.marked = None;
        }
        let s = state.borrow();
        assert_eq!(s.value, "controlled");
        assert_eq!(s.caret, utf16_len("controlled"));
        assert!(s.marked.is_none());
    }
}
