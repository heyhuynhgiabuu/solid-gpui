//! HostView: the GPUI view that renders the retained tree each frame.

use crate::frame_stats::FrameStats;
use gpui::{
    AnyElement, App, Bounds, Context, Div, Element, FocusHandle, FollowMode, InputHandler,
    InteractiveElement, IntoElement, LayoutId, ListAlignment, ListState, ParentElement, Pixels,
    Point, Render, Rgba, ScrollHandle, SharedString, StatefulInteractiveElement, Style, Styled,
    UTF16Selection, WeakEntity, Window, div, list, px, rgb, rgba, size,
};
use solid_gpui_protocol::EventType;
use solid_gpui_protocol::Mutation;
use solid_gpui_protocol::StyleMap;
use solid_gpui_protocol::StyleState;
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
    /// Selection anchor (shift-arrow/selection drag). None = collapsed.
    pub anchor: Option<usize>,
    /// IME composing (marked) range in UTF-16 code units, if active.
    pub marked: Option<Range<usize>>,
    /// An edit happened since the last committed change (blur/Enter). Drives
    /// DOM-style onChange: input events fire per keystroke; change commits.
    pub dirty: bool,
}

impl InputState {
    pub fn with_value(value: String) -> Self {
        let caret = utf16_len(&value);
        InputState {
            value,
            caret,
            anchor: None,
            marked: None,
            dirty: false,
        }
    }

    /// The active selection as a sorted UTF-16 range (start <= end).
    pub fn selection(&self) -> Range<usize> {
        match self.anchor {
            None => self.caret..self.caret,
            Some(a) => {
                let (start, end) = if a <= self.caret {
                    (a, self.caret)
                } else {
                    (self.caret, a)
                };
                start..end
            }
        }
    }

    /// Whether the caret sits before the anchor (a backwards selection) —
    /// the platform asks so shift-arrow keeps extending the right end.
    /// REVIEW NOTE (P2 r1 M4): set_selection always writes anchor <= caret
    /// (platform ranges arrive sorted), so reversed is only reachable via
    /// direct field writes today. If a platform ever delivers anchor-first
    /// ranges, teach set_selection direction instead of deleting this.
    pub fn selection_reversed(&self) -> bool {
        self.anchor.is_some_and(|a| a > self.caret)
    }

    /// Set caret + anchor from a platform UTF-16 range, clamped to the value.
    pub fn set_selection(&mut self, range: Range<usize>) {
        let len = utf16_len(&self.value);
        let start = range.start.min(len);
        let end = range.end.min(len).max(start);
        self.anchor = (start != end).then_some(start);
        self.caret = end;
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

/// Apply a UTF-16 edit to an input's shared state and emit an `input` event
/// carrying the new value (per-edit; `change` commits on blur/Enter).
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
        // None = "at the active selection" (anchor-aware) — backspace,
        // delete, and paste over a shift-arrow selection all arrive this way.
        let sel = range.unwrap_or_else(|| s.selection());
        let start = sel.start.min(len).min(sel.end.min(len));
        let end = sel.end.min(len).max(start);
        s.value = edit_utf16(&s.value, start..end, text);
        s.caret = start + utf16_len(text);
        s.anchor = None;
        s.marked = None;
        s.dirty = true;
        s.value.clone()
    };
    sink(&Event::Input {
        id,
        event_type: EventType::Input,
        x: None,
        y: None,
        key: None,
        modifiers: None,
        value: Some(new_value.clone()),
    });
    new_value
}

/// Canonical single-keystroke string: modifier order ctrl-alt-shift-cmd,
/// key lowercased ("ctrl-shift-p", "cmd-k", "escape").
fn canonical_keystroke(ks: &gpui::Keystroke) -> String {
    let mut out = String::new();
    if ks.modifiers.control {
        out.push_str("ctrl-");
    }
    if ks.modifiers.alt {
        out.push_str("alt-");
    }
    if ks.modifiers.shift {
        out.push_str("shift-");
    }
    if ks.modifiers.platform {
        out.push_str("cmd-");
    }
    out.push_str(&ks.key.to_lowercase());
    out
}

/// Parse one binding token into canonical form. Modifier aliases:
/// control→ctrl, meta/platform/super→cmd, option→alt. None when the token
/// has no key part.
fn canonical_token(token: &str) -> Option<String> {
    let mut key = String::new();
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut cmd = false;
    for part in token.split('-').filter(|p| !p.is_empty()) {
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => ctrl = true,
            "alt" | "option" => alt = true,
            "shift" => shift = true,
            "cmd" | "meta" | "platform" | "super" => cmd = true,
            _ => {
                if !key.is_empty() {
                    return None; // two key parts ("a-b") — not a keystroke
                }
                key = part.to_lowercase();
            }
        }
    }
    if key.is_empty() {
        return None;
    }
    let mut out = String::new();
    if ctrl {
        out.push_str("ctrl-");
    }
    if alt {
        out.push_str("alt-");
    }
    if shift {
        out.push_str("shift-");
    }
    if cmd {
        out.push_str("cmd-");
    }
    out.push_str(&key);
    Some(out)
}

/// A binding parsed into its canonical keystroke sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyBindingSeq(pub Vec<String>);

pub fn parse_binding(binding: &str) -> Option<KeyBindingSeq> {
    let mut seq = Vec::new();
    for token in binding.split_whitespace() {
        seq.push(canonical_token(token)?);
    }
    (!seq.is_empty()).then_some(KeyBindingSeq(seq))
}

/// Sequence state machine: `pending` is (binding index, keystrokes matched).
/// Returns the index of the binding that FIRED on this keystroke, if any.
/// A mismatch resets the pending sequence but still fresh-matches the
/// current keystroke (chords share no memory).
pub fn advance_binding(
    bindings: &[KeyBindingSeq],
    pending: &mut Option<(usize, usize)>,
    keystroke: &str,
) -> Option<usize> {
    if let Some((bi, matched)) = *pending {
        // Stale pending state (the binding list changed mid-sequence): the
        // index may point past the list, or the new binding at that index may
        // be shorter than the progress counter. Both mean "this sequence no
        // longer exists" — reset and fresh-match the stray key.
        let stale = match bindings.get(bi) {
            None => true,
            Some(seq) => matched >= seq.0.len(),
        };
        if stale {
            *pending = None;
            return advance_binding(bindings, pending, keystroke);
        }
        let seq = &bindings[bi];
        if keystroke == seq.0[matched] {
            if matched + 1 == seq.0.len() {
                *pending = None;
                return Some(bi);
            }
            *pending = Some((bi, matched + 1));
            return None;
        }
        // Mismatch: drop the pending sequence, fall through to fresh match.
        *pending = None;
    }
    for (i, seq) in bindings.iter().enumerate() {
        if keystroke == seq.0[0] {
            if seq.0.len() == 1 {
                return Some(i);
            }
            *pending = Some((i, 1));
            return None;
        }
    }
    None
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
    /// In-progress key-binding sequences: (binding index, keystrokes matched).
    key_pending: Rc<RefCell<HashMap<ElementId, (usize, usize)>>>,
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
    /// Children each list rendered last frame (see RenderCtx).
    list_children: HashMap<ElementId, Vec<ElementId>>,
    pub(crate) animations: HashMap<ElementId, ActiveAnimation>,
    /// Per-markdown-element parse + highlight cache (see MarkdownCacheEntry).
    /// Rc/RefCell like the other per-id maps: render reads it while `self`
    /// is borrowed by the Render impl.
    markdown_cache: crate::markdown::MarkdownCaches,
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
            key_pending: Rc::new(RefCell::new(HashMap::new())),
            sink: Rc::new(write_event_line),
            list_states: HashMap::new(),
            list_render_counts: HashMap::new(),
            list_alignment: HashMap::new(),
            list_follow_armed: HashSet::new(),
            list_children: HashMap::new(),
            animations: HashMap::new(),
            markdown_cache: Rc::new(RefCell::new(HashMap::new())),
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
        // A programmatic value invalidates any live selection: leaving a
        // stale anchor would make the next None-range edit replace
        // [anchor..caret] instead of inserting at the caret.
        s.anchor = None;
        s.marked = None;
        s.dirty = false;
    }

    /// simulateInput command + Enter-newline: apply a text edit through the
    /// same path as the platform IME (edit_input), emitting a per-edit input
    /// event. Fails when the id never rendered as input/textarea.
    pub fn simulate_input(&self, id: ElementId, text: &str) -> Result<(), String> {
        let Some(state) = self.input_states.borrow().get(&id).cloned() else {
            return Err(format!("no input/textarea for id {}", id.0));
        };
        edit_input(&state, id, None, text, &self.sink);
        Ok(())
    }

    /// Insert text at the active selection (textarea Enter-newline path from
    /// a keydown listener; selection-aware since P2).
    fn insert_text(&self, id: ElementId, text: &str) {
        if let Some(state) = self.input_states.borrow().get(&id).cloned() {
            edit_input(&state, id, None, text, &self.sink);
        }
    }

    /// Push a submit event (input Enter / textarea Shift+Enter).
    fn emit_submit(&self, id: ElementId) {
        self.emit_event(id, EventType::Submit, None, None, None, None, None);
    }

    /// Push a fired key-binding event (the original binding string).
    fn emit_keys(&self, id: ElementId, binding: &str) {
        self.emit_event(
            id,
            EventType::Keys,
            None,
            None,
            Some(binding.to_string()),
            None,
            None,
        );
    }

    /// DOM-style onChange commit: fire one change event carrying the current
    /// value when an input saw edits since its last commit (blur/Enter).
    /// No-op for pristine inputs or non-input ids.
    pub fn commit_input_if_dirty(&self, id: ElementId) {
        let Some(state) = self.input_states.borrow().get(&id).cloned() else {
            return;
        };
        let value = {
            let mut s = state.borrow_mut();
            if !s.dirty {
                return;
            }
            s.dirty = false;
            s.value.clone()
        };
        self.emit_event(id, EventType::Change, None, None, None, None, Some(value));
    }

    /// A content-changing mutation landed on `id` (setText/setStyle/setValue):
    /// if it sits inside a virtual list item, mark that item for remeasure so
    /// cached heights don't go stale (off-screen items keep their measured
    /// size in the List's summary until re-rendered; gpui re-anchors the
    /// scroll when the remeasured item is at the scroll top). Visible items
    /// re-measure every frame anyway — this is belt-and-suspenders for the
    /// off-screen cache.
    pub fn remeasure_content(&self, id: ElementId) {
        let Some((list_id, item_ix)) = list_item_containing(&self.tree, id) else {
            return;
        };
        if let Some(state) = self.list_states.get(&list_id) {
            state.remeasure_items(item_ix..item_ix + 1);
        }
    }

    /// Eagerly materialize a virtual list's state when a list element or its
    /// list styles apply — followTail alignment must be known before the
    /// first paint (render-population is lazy, same pattern as scroll/focus
    /// handles). Idempotent with the render-time get-or-create.
    ///
    /// Capture a setAnimation's runtime entry BEFORE the mutation applies
    /// (apply merges the targets into the static style, overwriting the old
    /// values the starts must come from). Retargeting mid-flight starts from
    /// the CURRENT interpolated value, not the old target — no jump. Returns
    /// None when apply will reject anyway (missing element / numeric start);
    /// the caller only inserts on apply success.
    pub fn prepare_animation(&self, m: &Mutation) -> Option<(ElementId, ActiveAnimation)> {
        let Mutation::SetAnimation {
            id,
            target,
            transition_ms,
            easing,
        } = m
        else {
            return None;
        };
        let node = self.tree.get(*id)?;
        let easing = easing
            .as_deref()
            .and_then(solid_gpui_protocol::Easing::parse)
            .unwrap_or(solid_gpui_protocol::Easing::EaseOut);
        let now = std::time::Instant::now();
        let mut transitions = Vec::with_capacity(target.len());
        for (key, value) in target {
            let StyleValue::Number(n) = value else {
                continue; // apply rejects non-numeric targets; entry discarded
            };
            let Some(to) = n.as_f64() else {
                continue;
            };
            let from = resolve_start(self.animations.get(id), node.style.get(key), key, now)?;
            transitions.push(AnimationTransition {
                key: key.clone(),
                from,
                to,
                started: now,
                duration_ms: *transition_ms,
                easing,
            });
        }
        if transitions.is_empty() {
            return None;
        }
        Some((*id, ActiveAnimation { transitions }))
    }

    /// Merge a freshly prepared entry into the runtime map WITHOUT dropping
    /// the element's other in-flight transitions: a second setAnimation for a
    /// different key mid-flight must not snap the first (review M1). Same-key
    /// transitions are replaced (retarget).
    pub(crate) fn upsert_animation(&mut self, id: ElementId, entry: ActiveAnimation) {
        let existing = self
            .animations
            .entry(id)
            .or_insert_with(|| ActiveAnimation {
                transitions: Vec::new(),
            });
        for tr in entry.transitions {
            match existing.transitions.iter_mut().find(|t| t.key == tr.key) {
                Some(slot) => *slot = tr,
                None => existing.transitions.push(tr),
            }
        }
    }

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
            // The fresh state has 0 items: the splice diff baseline must
            // follow, or the next render sees an empty range and never
            // populates the recreated state (regression: followTail toggle
            // emptied the list until the next children mutation).
            self.list_children.insert(id, Vec::new());
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
    /// Scroll a list's ListState to bring `index` to the viewport top
    /// (scrollToItem command). Fails when the id never rendered as a list.
    pub fn scroll_list_to_item(&self, id: ElementId, index: usize) -> Result<(), String> {
        let Some(state) = self.list_states.get(&id) else {
            return Err(format!("no list element for id {}", id.0));
        };
        state.scroll_to(gpui::ListOffset {
            item_ix: index,
            offset_in_item: px(0.),
        });
        Ok(())
    }

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
        // Through the injectable sink (write_event_line in production) so
        // tests observe every emitted event uniformly.
        (self.sink)(&Event::Input {
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
/// One interpolating key: numeric start -> target.
struct AnimationTransition {
    key: String,
    from: f64,
    to: f64,
    /// Per-key timing: a second setAnimation for a DIFFERENT key mid-flight
    /// upserts into the same entry without disturbing the first key's clock
    /// (entry-level timing snapped the older key to its target; review M1).
    started: std::time::Instant,
    duration_ms: u32,
    easing: solid_gpui_protocol::Easing,
}

/// Runtime state for one element's active setAnimation. Created at apply
/// time (starts captured from the element's current interpolated values, so
/// retargeting mid-flight does not jump); dropped by render once complete
/// or by reduce-motion (the static style already holds the target).
pub(crate) struct ActiveAnimation {
    transitions: Vec<AnimationTransition>,
}

impl ActiveAnimation {
    /// Current numeric value for `key`, or None when this animation does not
    /// touch it. Each transition runs on its own clock (M1).
    fn value_at(&self, key: &str, now: std::time::Instant) -> Option<f64> {
        self.transitions.iter().find(|tr| tr.key == key).map(|tr| {
            let progress = if tr.duration_ms == 0 {
                1.0
            } else {
                let elapsed = now.duration_since(tr.started).as_millis() as f64;
                (elapsed / f64::from(tr.duration_ms)).clamp(0.0, 1.0)
            };
            let t = ease(tr.easing, progress);
            tr.from + (tr.to - tr.from) * t
        })
    }

    /// True once every transition has clamped past its end.
    fn is_complete(&self, now: std::time::Instant) -> bool {
        self.transitions
            .iter()
            .all(|tr| now.duration_since(tr.started).as_millis() >= u128::from(tr.duration_ms))
    }
}

/// Cubic curves; t is clamped progress in [0,1]. No overshoot (springs are
/// deliberately out of scope for v1 wire semantics).
fn ease(easing: solid_gpui_protocol::Easing, t: f64) -> f64 {
    match easing {
        solid_gpui_protocol::Easing::Linear => t,
        solid_gpui_protocol::Easing::EaseIn => t * t * t,
        solid_gpui_protocol::Easing::EaseOut => 1.0 - (1.0 - t).powi(3),
        solid_gpui_protocol::Easing::EaseInOut => {
            if t < 0.5 {
                4.0 * t * t * t
            } else {
                1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
            }
        }
    }
}

/// Start value for a transition: the in-flight animation's CURRENT
/// interpolated value when retargeting (no jump), else the element's static
/// numeric value (None → apply will reject).
fn resolve_start(
    inflight: Option<&ActiveAnimation>,
    static_value: Option<&StyleValue>,
    key: &str,
    now: std::time::Instant,
) -> Option<f64> {
    inflight
        .and_then(|a| a.value_at(key, now))
        .or_else(|| match static_value {
            Some(StyleValue::Number(n)) => n.as_f64(),
            _ => None,
        })
}

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
    /// Children each list rendered last frame — the splice diff baseline
    /// (prefix/suffix diff keeps append/remove from resetting the scroll).
    list_children: &'a mut HashMap<ElementId, Vec<ElementId>>,
    /// In-flight setAnimation states; render substitutes interpolated values
    /// for the touched keys (the static style already holds the target).
    animations: &'a HashMap<ElementId, ActiveAnimation>,
    /// Set when a list state was created/reconciled this frame: gpui's first
    /// prepaint of fresh state wipes the uniform height hints, so atEnd
    /// reads null unless a SECOND frame re-hints. Nothing else re-renders a
    /// steady list, so render must request one settle frame itself.
    list_settle: std::rc::Rc<std::cell::Cell<bool>>,
    /// Snapshot taken at render start so every substitution in the frame
    /// interpolates against the same instant.
    now: std::time::Instant,
    /// Per-markdown-element parse + highlight cache (see MarkdownCacheEntry).
    md_highlights: &'a crate::markdown::MarkdownCaches,
}

/// The style value a build loop should apply for `key`: the interpolated
/// number while an animation is in flight, otherwise the static value.
fn effective_value(
    ctx: &RenderCtx,
    id: ElementId,
    key: &str,
    static_value: &StyleValue,
) -> StyleValue {
    if let Some(anim) = ctx.animations.get(&id)
        && let Some(v) = anim.value_at(key, ctx.now)
        && let Some(n) = serde_json::Number::from_f64(v)
    {
        return StyleValue::Number(n);
    }
    static_value.clone()
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
            range: s.selection(),
            reversed: s.selection_reversed(),
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
            // Mirror edit_input: None = at the ACTIVE selection, and the
            // edit collapses any live selection (IME composing replaces what
            // was selected instead of leaving a stale anchor).
            let sel = range_utf16.unwrap_or_else(|| s.selection());
            let start = sel.start.min(len).min(sel.end.min(len));
            let end = sel.end.min(len).max(start);
            s.value = edit_utf16(&s.value, start..end, new_text);
            let composed_end = start + utf16_len(new_text);
            s.caret = new_selected_range.map(|ns| ns.end).unwrap_or(composed_end);
            s.anchor = None;
            s.marked = Some(start..composed_end);
            s.dirty = true;
            s.value.clone()
        };
        (self.sink)(&Event::Input {
            id: self.id,
            event_type: EventType::Input,
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

    fn set_selected_text_range(
        &mut self,
        range_utf16: Range<usize>,
        _window: &mut Window,
        cx: &mut App,
    ) {
        // Arrow keys / home / end / click-to-position land here. Movement is
        // not a value edit: update state, repaint for the caret, emit nothing.
        self.state.borrow_mut().set_selection(range_utf16);
        self.repaint(cx);
    }

    fn paste(&mut self, item: gpui::ClipboardItem, _window: &mut Window, cx: &mut App) {
        // The platform supplies the clipboard payload; route it through the
        // same edit pipeline as typed text (selection-aware replace +
        // change event + repaint).
        if let Some(text) = item.text() {
            edit_input(&self.state, self.id, None, &text, &self.sink);
            self.repaint(cx);
        }
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

/// The precise splice range between last frame's children and the current
/// ones: the changed MIDDLE after the longest common prefix/suffix. Splicing
/// only this range keeps gpui's scroll rebase away from scroll positions
/// outside it — an append must not yank a manually scrolled-up chat to the
/// top (splice(0..old, new) rebases the scroll-top INTO the range). Pure —
/// unit-tested.
fn splice_range(old: &[ElementId], new: &[ElementId]) -> (Range<usize>, usize) {
    let prefix = old
        .iter()
        .zip(new.iter())
        .take_while(|(a, b)| a == b)
        .count();
    let suffix = old
        .iter()
        .rev()
        .zip(new.iter().rev())
        .take_while(|(a, b)| a == b)
        .count()
        .min(old.len() - prefix)
        .min(new.len() - prefix);
    let old_mid = old.len() - prefix - suffix;
    let new_mid = new.len() - prefix - suffix;
    (prefix..prefix + old_mid, new_mid)
}

/// If `id` is (inside) a list item, return the list element and the item
/// index. Walks up the parent chain; a list's DIRECT children are items, so
/// a changed node inside an item maps to that item (content changes must
/// remeasure the item, not the whole list). Pure — unit-tested.
fn list_item_containing(tree: &RetainedTree, id: ElementId) -> Option<(ElementId, usize)> {
    let mut cur = id;
    loop {
        let node = tree.get(cur)?;
        let parent = node.parent?;
        let parent_node = tree.get(parent)?;
        if parent_node.element_type == ElementType::List {
            return parent_node
                .children
                .iter()
                .position(|c| *c == cur)
                .map(|ix| (parent, ix));
        }
        cur = parent;
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
        let md_cache = self.markdown_cache.clone();
        md_cache
            .borrow_mut()
            .retain(|id, _| self.tree.get(*id).is_some());
        let host = cx.entity().downgrade();
        // Reset the virtualization counters: build_element's list items
        // increment them during layout, after this render call returns.
        for counter in self.list_render_counts.values() {
            counter.set(0);
        }
        // Animation clock: drop entries whose element is gone and entries
        // that finished (the static style already rests at the target).
        // reduce-motion skips interpolation entirely — entries are dropped
        // so the element jumps straight to the end state.
        let now = std::time::Instant::now();
        let reduce_motion = cx.reduce_motion();
        self.animations
            .retain(|id, a| !reduce_motion && self.tree.get(*id).is_some() && !a.is_complete(now));
        let animating = !self.animations.is_empty();
        let list_settle = std::rc::Rc::new(std::cell::Cell::new(false));
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
            list_children: &mut self.list_children,
            animations: &self.animations,
            now,
            md_highlights: &self.markdown_cache,
            list_settle: list_settle.clone(),
        };
        let mut content = match self.tree.root() {
            Some(root) => build_element(&self.tree, root, window, cx, &mut ctx),
            // No root yet: dark placeholder keeps the window alive pre-mount.
            None => div().size_full().bg(rgb(0x1e1e2e)).into_any_element(),
        };
        self.stats.push(started.elapsed());

        // While any transition is in flight, keep the frame loop alive so
        // interpolation advances (settles on its own once all complete). A
        // list whose state was just populated also needs ONE more frame: the
        // state's first prepaint wipes the uniform height hints and nothing
        // else would re-render the steady list to re-hint them (atEnd stayed
        // null forever after single-frame mounts; observed flaky in CI-like
        // load). Self-terminating: the settle frame splices nothing.
        if animating || list_settle.get() {
            window.request_animation_frame();
        }

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
    if node.element_type == ElementType::Markdown {
        return build_markdown_element(tree, id, window, ctx);
    }
    let mut el = div();
    for (key, value) in &node.style {
        el = apply_style(el, key, &effective_value(ctx, id, key, value));
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
    let wants_focus = tab_index.is_some()
        || has_focus
        || has_key
        || has_autofocus
        || !node.key_bindings.is_empty();
    if !element_needs_stateful(node, axis.is_some(), has_click, wants_focus) {
        return el.into_any_element();
    }

    let el = el.id(id.0 as usize);
    let el = apply_interactive(el, tree, id, window, cx, ctx, tab_index, false);
    el.into_any_element()
}

/// Whether the plain-div path must become stateful (id + interactivity).
/// State layers (hover/active) need a Stateful element for gpui's
/// hover()/active() refinements — without this check they would be stored
/// on the wire, acked, and silently never rendered (applied count lies;
/// AGENTS.md invariant 1).
fn element_needs_stateful(
    node: &solid_gpui_protocol::Node,
    has_overflow: bool,
    has_click: bool,
    wants_focus: bool,
) -> bool {
    has_overflow || has_click || wants_focus || !node.state_styles.is_empty()
}

/// Markdown element: parse the node's text (markdown source), highlight its
/// code fences, and render the block tree. gpui calls render() per FRAME, so
/// both the parse AND the tree-sitter highlighting are cached per element and
/// recomputed only when the source text changes — tree-sitter per frame would
/// be far too expensive to accept as v1 debt. The resolver is CONTENT-keyed
/// (language + code): identical fences share one document; different code of
/// the same language must never receive another fence's line-relative spans.
/// Element styles: `color` overrides body text, `backgroundColor` washes the
/// wrapper, `fontSize` (14 = 1.0×) scales every metric linearly.
fn build_markdown_element(
    tree: &RetainedTree,
    id: ElementId,
    window: &mut Window,
    ctx: &RenderCtx,
) -> AnyElement {
    let node = tree.get(id).expect("checked by caller");
    let source = node.text.clone().unwrap_or_default();

    // Get-or-recompute the parse + highlight entry for this element's source.
    let mut cache = ctx.md_highlights.borrow_mut();
    let needs_rebuild = match cache.get(&id) {
        Some(entry) => entry.source != source,
        None => true,
    };
    if needs_rebuild {
        cache.insert(id, crate::markdown::MarkdownCacheEntry::build(&source));
    }
    let entry_tree = cache.get(&id).expect("just inserted").tree.clone();
    drop(cache);

    // Content-keyed resolution over the cached fence list. Cloning the Rc is
    // the whole cost per frame per code block; the RefCell borrow never
    // re-enters a mutation (render does not write the cache).
    let highlight = |lang: Option<&str>,
                     code: &str|
     -> Option<std::rc::Rc<crate::markdown::syntax::HighlightedDocument>> {
        let cache = ctx.md_highlights.borrow();
        let entry = cache.get(&id)?;
        entry.resolve(lang, code)
    };

    let mut theme = crate::markdown::render::MdTheme::default();
    if let Some(color) = node.style.get("color").and_then(parse_color) {
        theme.text = color.into();
    }
    let scale = style_num(&node.style, "fontSize")
        .map_or(1.0, |f| {
            (f / crate::markdown::render::MD_TEXT_SIZE as f64) as f32
        })
        .max(0.1);
    let row = format!("md{}", id.0);
    let inner =
        crate::markdown::render::render_tree(&row, &entry_tree, &theme, scale, window, &highlight);
    let mut el = div().flex_col().child(inner);
    if let Some(bg) = node.style.get("backgroundColor").and_then(parse_color) {
        el = el.bg(bg);
    }
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
    // Key bindings make the element focusable TOO (mirroring build_element's
    // element_needs_stateful gate): gpui delivers keys only to the focused
    // element, so a keys-only div must be focusable for its bindings to
    // ever fire. The two gates MUST stay in sync.
    let wants_focus = force_focus
        || tab_index.is_some()
        || has_focus
        || has_key
        || has_autofocus
        || !node.key_bindings.is_empty();

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
                // DOM-style onChange: blur commits pending edits.
                view.commit_input_if_dirty(id);
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
    if !node.key_bindings.is_empty() {
        // Shortcuts/sequences: a listener ON THE FOCUSED ELEMENT, so bindings
        // never compete with other elements' key handlers. Bindings are read
        // from the tree at event time (a re-render may have replaced them);
        // pending-sequence progress lives on the view. Unparseable entries
        // are filtered in lockstep so the fired index maps to the raw string.
        let listener = cx.listener(move |view, event: &gpui::KeyDownEvent, _window, _cx| {
            let Some(node) = view.tree.get(id) else {
                return;
            };
            let raw: Vec<String> = node.key_bindings.clone();
            if raw.is_empty() {
                return;
            }
            let parsed_ok: Vec<String> = raw
                .iter()
                .filter(|b| parse_binding(b).is_some())
                .cloned()
                .collect();
            let parsed: Vec<KeyBindingSeq> =
                parsed_ok.iter().filter_map(|b| parse_binding(b)).collect();
            let ks = canonical_keystroke(&event.keystroke);
            let fired = {
                let mut guard = view.key_pending.borrow_mut();
                let mut pm = guard.get(&id).copied();
                let r = advance_binding(&parsed, &mut pm, &ks);
                match pm {
                    Some(v) => {
                        guard.insert(id, v);
                    }
                    None => {
                        guard.remove(&id);
                    }
                }
                r
            };
            if let Some(binding) = fired.and_then(|fi| parsed_ok.get(fi)) {
                view.emit_keys(id, binding);
            }
        });
        el = el.on_key_down(listener);
    }
    // State layers last: they are style refinements over whatever the base
    // style + interactivity produced, and need the stateful element id.
    el = apply_state_styles(el, node);
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
        el = apply_style(el, key, &effective_value(ctx, id, key, value));
    }
    // Textarea autosize: rows = line count clamped to [minRows, maxRows],
    // height = rows * line height + vertical padding. v1 measures the logical
    // line count, not wrapped lines (no reflow-aware measurement). v1
    // limitation: the height computation reads the STATIC fontSize/padding,
    // so animating those keys snaps the outer height to its end state at t=0
    // while the values themselves interpolate (documented; review Minor 1).
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
                view.commit_input_if_dirty(id);
                view.emit_submit(id);
            } else {
                view.insert_text(id, "\n");
            }
        } else {
            view.commit_input_if_dirty(id);
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
#[allow(clippy::too_many_arguments)]
/// List vertical alignment (P5): explicit `listAlign` ("top"|"bottom") wins;
/// otherwise followTail implies Bottom (the pre-P5 semantic). Unknown values
/// fall through to the followTail rule (open-value drop). Pure — unit-tested.
fn resolve_list_alignment(node: &solid_gpui_protocol::Node) -> gpui::ListAlignment {
    let follow_tail = node.style.contains_key("followTail");
    match node.style.get("listAlign").and_then(StyleValue::as_str) {
        Some("top") => gpui::ListAlignment::Top,
        Some("bottom") => gpui::ListAlignment::Bottom,
        _ => {
            if follow_tail {
                gpui::ListAlignment::Bottom
            } else {
                gpui::ListAlignment::Top
            }
        }
    }
}

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
    let alignment = resolve_list_alignment(node);
    // Overdraw: extra px rendered above/below the viewport so scrolling
    // doesn't pop. Default 500 preserves pre-P5 behavior; the style key is
    // a plain number (open style-key rule).
    let overdraw = px(style_num(&node.style, "overdraw").unwrap_or(500.0) as f32);
    if ctx.list_alignment.get(&id) != Some(&alignment) {
        ctx.list_states
            .insert(id, ListState::new(0, alignment, overdraw));
        ctx.list_alignment.insert(id, alignment);
        ctx.list_follow_armed.remove(&id);
        // Reset the splice baseline with the fresh 0-item state (see
        // ensure_list_state — a stale baseline would skip the populate
        // splice and render an empty list).
        ctx.list_children.insert(id, Vec::new());
    }
    let state = ctx
        .list_states
        .entry(id)
        .or_insert_with(|| ListState::new(0, alignment, overdraw))
        .clone();
    // Precise splice via prefix/suffix diff against last frame's children:
    // splice(0..old, new) rebases the scroll-top INTO the range and resets
    // it to the top on EVERY count change — an append would yank a manually
    // scrolled-up chat back to the top. Splicing only the changed middle
    // keeps scroll positions outside the range untouched.
    {
        let prev = ctx.list_children.entry(id).or_default();
        let (range, new_mid) = splice_range(prev, &node.children);
        if !range.is_empty() || new_mid != 0 {
            state.splice(range, new_mid);
            // A populated/fresh state needs one more frame after its first
            // prepaint wiped the hints (see RenderCtx::list_settle).
            ctx.list_settle.set(true);
        }
        *prev = node.children.clone();
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
    // Frame-start clock snapshot: items interpolate against the same instant
    // as the rest of the frame even though the List builds them later in
    // layout.
    let frame_now = ctx.now;
    let item_settle = ctx.list_settle.clone();
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
                list_children: &mut view.list_children,
                animations: &view.animations,
                now: frame_now,
                md_highlights: &view.markdown_cache,
                list_settle: item_settle.clone(),
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
    //
    // The wrapper's height: an explicit height style wins; a root list falls
    // back to the window height (the window root has no definite parent for
    // percentages); any other list uses 100% of its parent — which resolves
    // only when the parent chain provides a definite height (the CSS rule;
    // a list inside an auto-height column must be given a height).
    let wrapper = match style_num(&node.style, "height") {
        Some(h) => div().w_full().h(px(h as f32)),
        None if tree.root() == Some(id) => div().w_full().h(px(window.bounds().size.height.into())),
        None => div().w_full().h_full(),
    };
    let mut el = wrapper.flex().child(list(state_el, render_item));
    for (key, value) in &node.style {
        el = apply_style(el, key, &effective_value(ctx, id, key, value));
    }
    let el = el.id(id.0 as usize);
    let el = apply_interactive(el, tree, id, window, cx, ctx, None, false);
    el.into_any_element()
}

/// Layer hover/active state styles onto an element (P1-c). gpui owns the
/// interaction detection; we hand it StyleRefinements built from the wire's
/// state-layer style maps. Applied after the base loop so layers stack on
/// whatever the base set (gpui merges refinements over the base style).
fn apply_state_styles(
    mut el: gpui::Stateful<Div>,
    node: &solid_gpui_protocol::Node,
) -> gpui::Stateful<Div> {
    if let Some(hover) = node.state_styles.get(&StyleState::Hover) {
        el = el.hover(|s| apply_refinement(s, hover));
    }
    if let Some(active) = node.state_styles.get(&StyleState::Active) {
        el = el.active(|s| apply_refinement(s, active));
    }
    el
}

/// State-layer subset of apply_style, operating on a StyleRefinement (which
/// implements Styled, so the same fluent methods apply). Unknown keys are
/// ignored exactly like base styles.
fn apply_refinement(mut s: gpui::StyleRefinement, map: &StyleMap) -> gpui::StyleRefinement {
    for (key, value) in map {
        let key: &str = key;
        s = apply_style(s, key, value);
    }
    s
}

/// v1 style subset; unknown keys and unparsable values are ignored by design.
/// Generic over Styled so the same matcher drives base styles (Div) and
/// state-layer refinements (StyleRefinement) — one table, two callers.
fn apply_style<S: gpui::Styled>(mut el: S, key: &str, value: &StyleValue) -> S {
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
        "paddingTop" => {
            if let Some(n) = num {
                el = el.pt(px(n as f32));
            }
        }
        "paddingRight" => {
            if let Some(n) = num {
                el = el.pr(px(n as f32));
            }
        }
        "paddingBottom" => {
            if let Some(n) = num {
                el = el.pb(px(n as f32));
            }
        }
        "paddingLeft" => {
            if let Some(n) = num {
                el = el.pl(px(n as f32));
            }
        }
        "margin" => {
            if let Some(n) = num {
                el = el.m(px(n as f32));
            }
        }
        "marginTop" => {
            if let Some(n) = num {
                el = el.mt(px(n as f32));
            }
        }
        "marginRight" => {
            if let Some(n) = num {
                el = el.mr(px(n as f32));
            }
        }
        "marginBottom" => {
            if let Some(n) = num {
                el = el.mb(px(n as f32));
            }
        }
        "marginLeft" => {
            if let Some(n) = num {
                el = el.ml(px(n as f32));
            }
        }
        "top" => {
            if let Some(n) = num {
                el = el.top(px(n as f32));
            }
        }
        "right" => {
            if let Some(n) = num {
                el = el.right(px(n as f32));
            }
        }
        "bottom" => {
            if let Some(n) = num {
                el = el.bottom(px(n as f32));
            }
        }
        "left" => {
            if let Some(n) = num {
                el = el.left(px(n as f32));
            }
        }
        "boxShadow" => {
            if let Some(shadow) = parse_box_shadow(value) {
                el = el.shadow(vec![shadow]);
            }
        }
        "lineClamp" => {
            if let Some(n) = num {
                let lines = (n as usize).max(1);
                el = el.line_clamp(lines);
            }
        }
        "whiteSpace" => match value.as_str() {
            Some("nowrap") => el = el.whitespace_nowrap(),
            Some("normal") => el = el.whitespace_normal(),
            _ => {}
        },
        "textOverflow" => {
            if value.as_str() == Some("ellipsis") {
                el = el.text_ellipsis();
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
    let s = value.as_str()?.trim();
    if let Some(h) = s.strip_prefix('#') {
        return match h.len() {
            6 => u32::from_str_radix(h, 16).ok().map(rgb),
            8 => u32::from_str_radix(h, 16).ok().map(rgba),
            _ => None,
        };
    }
    if let Some(rest) = s.strip_prefix("rgb(").and_then(|r| r.strip_suffix(')')) {
        let [r, g, b] = css_ints(rest, 255)?;
        return Some(rgb(((r as u32) << 16) | ((g as u32) << 8) | b as u32));
    }
    if let Some(rest) = s.strip_prefix("rgba(").and_then(|r| r.strip_suffix(')')) {
        let [r, g, b] = css_ints(rest.rsplit_once(',')?.0, 255)?;
        let a = css_alpha(rest)?;
        let a8 = (a * 255.0).round() as u32;
        return Some(rgba(
            (((r as u32) << 16) | ((g as u32) << 8) | b as u32) << 8 | a8,
        ));
    }
    if let Some(rest) = s.strip_prefix("hsl(").and_then(|r| r.strip_suffix(')')) {
        return hsl_to_rgba(rest, 1.0);
    }
    if let Some(rest) = s.strip_prefix("hsla(").and_then(|r| r.strip_suffix(')')) {
        let a = css_alpha(rest)?;
        return hsl_to_rgba(rest.rsplit_once(',')?.0, a);
    }
    named_color(s).or_else(|| {
        s.eq_ignore_ascii_case("transparent")
            .then_some(rgba(0x00000000))
    })
}

/// Parse the leading integer channels of an rgb()/rgba() body: exactly
/// three comma-separated u8-range integers.
fn css_ints(rest: &str, max: i64) -> Option<[i64; 3]> {
    let mut parts = rest.split(',').map(str::trim);
    let mut out = [0i64; 3];
    for slot in &mut out {
        let p = parts.next()?;
        let n: i64 = p.parse().ok()?;
        if !(0..=max).contains(&n) {
            return None;
        }
        *slot = n;
    }
    // A 4th channel means the caller wanted rgba() semantics under rgb()
    // spelling — reject rather than silently drop alpha.
    if parts.next().is_some() {
        return None;
    }
    Some(out)
}

/// Alpha channel of an rgba()/hsla() body: the LAST comma-separated field,
/// 0.0..=1.0, quantized to u8 like CSS serialization does.
fn css_alpha(rest: &str) -> Option<f64> {
    let last = rest.rsplit(',').next()?.trim();
    let a: f64 = last.parse().ok()?;
    if !(0.0..=1.0).contains(&a) {
        return None;
    }
    Some(a)
}

/// boxShadow string: "offsetX offsetY blur [color]" (CSS-ish). Color is any
/// format parse_color accepts; missing color means black. Fewer than three
/// numeric fields is ignored like any unparsable value.
fn parse_box_shadow(value: &StyleValue) -> Option<gpui::BoxShadow> {
    let text = value.as_str()?;
    let mut parts = text.split_whitespace();
    let x: f64 = parts.next()?.parse().ok()?;
    let y: f64 = parts.next()?.parse().ok()?;
    let blur: f64 = parts.next()?.parse().ok()?;
    let color = parts
        .next()
        .and_then(|c| parse_color(&StyleValue::Text(c.to_string())))
        .map(gpui::Hsla::from)
        .unwrap_or(gpui::black());
    Some(gpui::BoxShadow {
        color,
        offset: gpui::point(px(x as f32), px(y as f32)),
        blur_radius: px(blur as f32),
        spread_radius: px(0.),
        inset: false,
    })
}

/// hsl()/hsla() body: hue (deg, may exceed 360), saturation and lightness
/// (percent-suffixed), optional leading-trimmed alpha already extracted.
fn hsl_to_rgba(rest: &str, alpha: f64) -> Option<Rgba> {
    let mut parts = rest.split(',').map(str::trim);
    let h_deg: f64 = parts.next()?.trim_end_matches("deg").parse().ok()?;
    let s_pct = parts.next()?.strip_suffix('%')?.parse::<f64>().ok()?;
    let l_pct = parts.next()?.strip_suffix('%')?.parse::<f64>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    if !(0.0..=100.0).contains(&s_pct) || !(0.0..=100.0).contains(&l_pct) {
        return None;
    }
    // CSS hue wraps; keep it positive for the f32 hue gpui expects (0..1 of a turn).
    let h = ((h_deg % 360.0) + 360.0) % 360.0 / 360.0;
    let s = s_pct / 100.0;
    let l = l_pct / 100.0;
    Some(gpui::hsla(h as f32, s as f32, l as f32, alpha as f32).into())
}

/// The CSS-named subset every UI needs; extended on demand. Case-insensitive.
fn named_color(s: &str) -> Option<Rgba> {
    let hex: u32 = match s.to_ascii_lowercase().as_str() {
        "black" => 0x000000ff,
        "white" => 0xffffffff,
        "red" => 0xff0000ff,
        "lime" => 0x00ff00ff,
        "green" => 0x008000ff,
        "blue" => 0x0000ffff,
        "yellow" => 0xffff00ff,
        "orange" => 0xffa500ff,
        "purple" => 0x800080ff,
        "pink" => 0xffc0cbff,
        "gray" | "grey" => 0x808080ff,
        "cyan" | "aqua" => 0x00ffffff,
        "magenta" | "fuchsia" => 0xff00ffff,
        "brown" => 0xa52a2aff,
        "navy" => 0x000080ff,
        "teal" => 0x008080ff,
        "olive" => 0x808000ff,
        "maroon" => 0x800000ff,
        _ => return None,
    };
    Some(rgba(hex))
}

#[cfg(test)]
mod parse_color_tests {
    use super::*;
    use gpui::Rgba;

    fn sv(s: &str) -> StyleValue {
        StyleValue::Text(s.to_string())
    }

    fn rgba_parts(c: Rgba) -> (f32, f32, f32, f32) {
        let gpui::Hsla { h, s, l, a } = c.into();
        (h, s, l, a)
    }

    #[test]
    fn hex_still_works() {
        assert_eq!(parse_color(&sv("#ff0000")), Some(rgb(0xff0000)));
        assert_eq!(parse_color(&sv("#ff000080")), Some(rgba(0xff000080)));
        assert_eq!(parse_color(&sv("#xyz")), None);
        assert_eq!(parse_color(&StyleValue::Number(12u32.into())), None);
    }

    #[test]
    fn css_function_colors() {
        // rgb()/rgba() integers 0-255.
        assert_eq!(parse_color(&sv("rgb(255, 0, 0)")), Some(rgb(0xff0000)));
        assert_eq!(
            parse_color(&sv("rgba(18, 52, 86, 0.5)")),
            Some(rgba(0x12345680))
        );
        // Whitespace-tolerant.
        assert_eq!(parse_color(&sv("rgb( 0,128,255 )")), Some(rgb(0x0080ff)));
        assert_eq!(parse_color(&sv("rgb(1,2)")), None);
        assert_eq!(parse_color(&sv("rgb(a,b,c)")), None);
        assert_eq!(parse_color(&sv("rgb(256,0,0)")), None);
    }

    #[test]
    fn hsl_function_colors() {
        // hsl(120,50%,50%) ≙ #40bf40 (rgb 64,191,64).
        let c = rgba_parts(parse_color(&sv("hsl(120, 50%, 50%)")).unwrap());
        let expected = rgba_parts(rgb(0x40bf40));
        // Channels round-trip through u8 quantization on the expected side;
        // 1/255 of a channel is the floor of achievable agreement.
        for (got, want) in [c.0, c.1, c.2]
            .iter()
            .zip([expected.0, expected.1, expected.2])
        {
            assert!(
                (got - want).abs() < 5e-3,
                "hsl channel off: {got} vs {want}"
            );
        }
        // Alpha channel: hsla half-transparent.
        let d = rgba_parts(parse_color(&sv("hsla(0, 100%, 50%, 0.5)")).unwrap());
        assert!((d.3 - 0.5).abs() < 1e-3);
        // Hue wraps at 360 and percentages are required to be unambiguous.
        assert!(parse_color(&sv("hsl(120, 50, 50)")).is_none());
        assert!(parse_color(&sv("hsl(400, 10%, 10%)")).is_some());
    }

    #[test]
    fn named_colors() {
        assert_eq!(parse_color(&sv("red")), Some(rgb(0xff0000)));
        assert_eq!(parse_color(&sv("ReD")), Some(rgb(0xff0000)));
        assert_eq!(parse_color(&sv("white")), Some(rgb(0xffffff)));
        assert_eq!(parse_color(&sv("black")), Some(rgb(0x000000)));
        assert_eq!(parse_color(&sv("notacolor")), None);
        let t = rgba_parts(parse_color(&sv("transparent")).unwrap());
        assert!(t.3 < 1e-6, "transparent must have zero alpha");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::Rgba;

    #[test]
    fn easing_curves_hit_their_endpoints_and_midpoints() {
        use solid_gpui_protocol::Easing;
        let e = |c: Easing, t: f64| ease(c, t);
        for c in [
            Easing::Linear,
            Easing::EaseIn,
            Easing::EaseOut,
            Easing::EaseInOut,
        ] {
            assert!((e(c, 0.0) - 0.0).abs() < 1e-9, "{c:?} at 0");
            assert!((e(c, 1.0) - 1.0).abs() < 1e-9, "{c:?} at 1");
            // Monotonic on a coarse grid: progress never runs backwards.
            let mut prev = 0.0;
            for i in 1..=10 {
                let t = f64::from(i) / 10.0;
                let v = e(c, t);
                assert!(v >= prev - 1e-9, "{c:?} not monotonic at {t}");
                prev = v;
            }
        }
        assert!((e(Easing::Linear, 0.25) - 0.25).abs() < 1e-9);
        assert!((e(Easing::EaseInOut, 0.5) - 0.5).abs() < 1e-9);
        // easeOut front-loads: more than half the distance at t=0.5.
        assert!(e(Easing::EaseOut, 0.5) > 0.5);
        assert!(e(Easing::EaseIn, 0.5) < 0.5);
    }

    fn transition(key: &str, from: f64, to: f64, duration_ms: u32) -> AnimationTransition {
        AnimationTransition {
            key: key.into(),
            from,
            to,
            started: std::time::Instant::now(),
            duration_ms,
            easing: solid_gpui_protocol::Easing::Linear,
        }
    }

    #[test]
    fn animation_interpolates_lerped_values_and_clamps_past_end() {
        let anim = ActiveAnimation {
            transitions: vec![transition("width", 200.0, 300.0, 100)],
        };
        // The 0ms instant is captured at creation; a slightly later `now`
        // must yield the exact linear interpolation.
        let start = anim.transitions[0].started;
        let t25 = start + std::time::Duration::from_millis(25);
        assert_eq!(anim.value_at("width", t25), Some(225.0));
        // Untouched keys are None.
        assert_eq!(anim.value_at("opacity", t25), None);
        // Past the end clamps to the target (render drops it right after).
        let past = start + std::time::Duration::from_millis(500);
        assert_eq!(anim.value_at("width", past), Some(300.0));
        assert!(anim.is_complete(past));
        assert!(!anim.is_complete(t25));
    }

    #[test]
    fn retarget_start_comes_from_the_inflight_value_not_the_old_target() {
        // First animation: 200 -> 300 over 100ms, linear.
        let inflight = ActiveAnimation {
            transitions: vec![transition("width", 200.0, 300.0, 100)],
        };
        let now = inflight.transitions[0].started + std::time::Duration::from_millis(50);
        // The static style ALREADY holds the old target (apply merged it).
        let static_value = StyleValue::Number(300u32.into());
        // Retargeting at the halfway point must start at the CURRENT
        // interpolated 250, not jump from the merged 300.
        assert_eq!(
            resolve_start(Some(&inflight), Some(&static_value), "width", now),
            Some(250.0)
        );
        // With no animation running, the static value is the start.
        assert_eq!(
            resolve_start(None, Some(&static_value), "width", now),
            Some(300.0)
        );
        // No numeric static value → None (apply rejects).
        assert_eq!(resolve_start(None, None, "width", now), None);
    }

    #[test]
    fn zero_duration_animation_jumps_to_target() {
        let anim = ActiveAnimation {
            transitions: vec![transition("opacity", 1.0, 0.0, 0)],
        };
        assert_eq!(
            anim.value_at("opacity", anim.transitions[0].started),
            Some(0.0)
        );
    }

    #[test]
    fn staggered_second_animation_keeps_the_first_keys_clock() {
        // Review M1 regression: flip width (400ms), then 300ms later flip
        // opacity (100ms). The upsert must keep BOTH transitions running on
        // their own clocks — width at 75% when the second lands, and the
        // entry must not read complete until the OLDER key finishes.
        let mut view = HostView::new();
        view.tree
            .apply(&solid_gpui_protocol::Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            })
            .unwrap();
        view.tree
            .apply(&solid_gpui_protocol::Mutation::SetStyle {
                id: 1.into(),
                style: StyleMap::from([
                    ("width".to_string(), StyleValue::Number(200u32.into())),
                    ("opacity".to_string(), StyleValue::Number(1u32.into())),
                ]),
                state: None,
            })
            .unwrap();

        let first = view
            .prepare_animation(&solid_gpui_protocol::Mutation::SetAnimation {
                id: 1.into(),
                target: StyleMap::from([("width".to_string(), StyleValue::Number(300u32.into()))]),
                transition_ms: 400,
                easing: Some("linear".to_string()),
            })
            .expect("first prepares");
        let t0 = first.1.transitions[0].started;
        view.upsert_animation(first.0, first.1);

        std::thread::sleep(std::time::Duration::from_millis(300));
        let second = view
            .prepare_animation(&solid_gpui_protocol::Mutation::SetAnimation {
                id: 1.into(),
                target: StyleMap::from([(
                    "opacity".to_string(),
                    StyleValue::Number(serde_json::Number::from_f64(0.5).unwrap()),
                )]),
                transition_ms: 100,
                easing: Some("linear".to_string()),
            })
            .expect("second prepares");
        let t1 = second.1.transitions[0].started;
        view.upsert_animation(second.0, second.1);

        let entry = view.animations.get(&1.into()).unwrap();
        // Width still animates on its OWN clock (300ms into 400ms = 75%):
        // the pre-fix insert() would have dropped it entirely.
        assert_eq!(
            entry.value_at("width", t0 + std::time::Duration::from_millis(300)),
            Some(275.0)
        );
        // Opacity runs on the second clock (starts now).
        assert_eq!(entry.value_at("opacity", t1), Some(1.0));
        // Entry completes only when the OLDER transition completes.
        assert!(!entry.is_complete(t0 + std::time::Duration::from_millis(350)));
        assert!(entry.is_complete(t0 + std::time::Duration::from_millis(450)));
    }

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
        // "red" became VALID with named-color support; use junk strings.
        assert!(parse_color(&StyleValue::Text("notacolor".into())).is_none());
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
    fn edit_input_emits_input_event_with_new_value_and_moves_caret() {
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
                // P2 split: per-edit edits emit `input`; `change` commits on
                // blur/Enter (commit_input_if_dirty).
                assert_eq!(*event_type, EventType::Input);
                assert_eq!(value.as_deref(), Some("hi🎉"));
            }
        }
    }

    #[test]
    fn list_item_containing_maps_descendants_to_item_index() {
        // list(1) -> items 2,3; item 2 -> deep child 4.
        use solid_gpui_protocol::Mutation;
        let mut tree = RetainedTree::new();
        for (id, et) in [
            (1u32, ElementType::List),
            (2, ElementType::Div),
            (3, ElementType::Div),
            (4, ElementType::Div),
        ] {
            tree.apply(&Mutation::CreateElement {
                id: id.into(),
                element_type: et,
            })
            .unwrap();
        }
        for (p, c) in [(1u32, 2u32), (1, 3), (2, 4)] {
            tree.apply(&Mutation::AppendChild {
                parent_id: p.into(),
                child_id: c.into(),
            })
            .unwrap();
        }
        assert_eq!(list_item_containing(&tree, 2.into()), Some((1.into(), 0)));
        assert_eq!(list_item_containing(&tree, 4.into()), Some((1.into(), 0)));
        assert_eq!(list_item_containing(&tree, 3.into()), Some((1.into(), 1)));
        assert_eq!(list_item_containing(&tree, 1.into()), None); // the list itself
        assert_eq!(list_item_containing(&tree, 99.into()), None); // missing
    }

    #[test]
    fn splice_range_only_covers_the_changed_middle() {
        let id = |n: u32| ElementId(n);
        // Append at the end: empty old range — the scroll rebase never
        // touches positions at or before the old end.
        assert_eq!(
            splice_range(&[id(1), id(2)], &[id(1), id(2), id(3)]),
            (2..2, 1)
        );
        // Remove the first item: only that slot.
        assert_eq!(
            splice_range(&[id(1), id(2), id(3)], &[id(2), id(3)]),
            (0..1, 0)
        );
        // Insert mid-list.
        assert_eq!(
            splice_range(&[id(1), id(3)], &[id(1), id(2), id(3)]),
            (1..1, 1)
        );
        // Identical: an EMPTY range (position varies; only emptiness matters).
        let (r, n) = splice_range(&[id(1)], &[id(1)]);
        assert!(r.is_empty() && n == 0, "got {r:?} {n}");
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

#[cfg(test)]
mod element_needs_stateful_tests {
    use super::*;
    use solid_gpui_protocol::StyleMap;

    fn node_with_state(state: Option<StyleState>) -> solid_gpui_protocol::Node {
        // Build via the retained tree's public apply API (Node::new is
        // crate-private to the protocol): createElement + state-layered
        // setStyle gives us exactly the node shape under test.
        let mut tree = solid_gpui_protocol::RetainedTree::new();
        tree.apply(&Mutation::CreateElement {
            id: ElementId(1),
            element_type: ElementType::Div,
        })
        .unwrap();
        if let Some(s) = state {
            tree.apply(&Mutation::SetStyle {
                id: ElementId(1),
                style: StyleMap::from([(
                    "backgroundColor".to_string(),
                    StyleValue::Text("#ff0000".into()),
                )]),
                state: Some(s),
            })
            .unwrap();
        }
        tree.get(ElementId(1)).unwrap().clone()
    }

    #[test]
    fn plain_div_stays_stateless_but_state_layers_force_stateful() {
        // The regression: a div with no click/focus/overflow MUST still go
        // stateful when it carries hover/active layers — otherwise they are
        // acked but silently never rendered.
        assert!(!element_needs_stateful(
            &node_with_state(None),
            false,
            false,
            false
        ));
        assert!(element_needs_stateful(
            &node_with_state(Some(StyleState::Hover)),
            false,
            false,
            false
        ));
        assert!(element_needs_stateful(
            &node_with_state(Some(StyleState::Active)),
            false,
            false,
            false
        ));
    }
}

#[cfg(test)]
mod input_selection_tests {
    use super::*;

    #[test]
    fn selection_resolves_collapse_or_range() {
        // Collapsed: no anchor → caret..caret.
        let mut s = InputState::with_value("hello".into());
        s.caret = 2;
        assert_eq!(s.selection(), 2..2);
        // Shift-arrow sets an anchor; forward selection is not reversed.
        s.set_selection(4..5);
        assert_eq!(s.selection(), 4..5);
        assert!(!s.selection_reversed());
        // Backwards selection (caret left of anchor) IS reversed.
        s.caret = 2;
        s.anchor = Some(4);
        assert_eq!(s.selection(), 2..4);
        assert!(s.selection_reversed());
        // Anchor cleared → collapsed again.
        s.anchor = None;
        assert_eq!(s.selection(), 2..2);
    }

    #[test]
    fn selection_clamps_to_value_length() {
        let mut s = InputState::with_value("ab".into());
        s.set_selection(1..99);
        assert_eq!(s.selection(), 1..2);
        s.set_selection(50..60);
        assert_eq!(s.selection(), 2..2);
    }

    #[test]
    fn edit_at_selection_replaces_and_collapses() {
        // edit_input with None range must use the ACTIVE selection, not just
        // the caret — that's how shift-arrow + backspace/delete/paste over a
        // selection work.
        let mut s = InputState::with_value("a🎉b".into());
        s.set_selection(1..3); // the emoji (2 UTF-16 units)
        s.anchor = Some(1);
        let state = Rc::new(RefCell::new(s));
        let events = Rc::new(RefCell::new(Vec::new()));
        let sink_events = events.clone();
        let sink: Rc<dyn Fn(&Event)> = Rc::new(move |e: &Event| {
            sink_events
                .borrow_mut()
                .push(format!("{:?}", e.event_type()));
        });
        let out = edit_input(&state, ElementId(1), None, "!", &sink);
        assert_eq!(out, "a!b");
        assert_eq!(state.borrow().caret, 2);
        assert_eq!(state.borrow().anchor, None, "edit collapses the selection");
    }
}

#[cfg(test)]
mod input_commit_tests {
    use super::*;

    fn host_with_input(value: &str) -> (HostView, ElementId) {
        let view = HostView::new();
        view.set_input_value(ElementId(1), value);
        (view, ElementId(1))
    }

    #[test]
    fn commit_input_if_dirty_commits_once_then_silent() {
        type Observed = Rc<RefCell<Vec<(EventType, Option<String>)>>>;
        let events: Observed = Rc::new(RefCell::new(Vec::new()));
        let sink_events = events.clone();
        let mut view = HostView::new();
        view.sink = Rc::new(move |e: &Event| {
            let Event::Input {
                event_type, value, ..
            } = e;
            sink_events.borrow_mut().push((*event_type, value.clone()));
        });
        let id = ElementId(1);
        view.set_input_value(id, "hi");

        // No edits yet → no commit.
        view.commit_input_if_dirty(id);
        assert!(events.borrow().is_empty());

        // Edits emit per-keystroke `input`; blur commits ONE `change`.
        view.simulate_input(id, "!").unwrap();
        view.simulate_input(id, "x").unwrap();
        assert_eq!(events.borrow().len(), 2);
        view.commit_input_if_dirty(id);
        {
            let ev = events.borrow();
            assert_eq!(ev.len(), 3);
            assert_eq!(ev[2], (EventType::Change, Some("hi!x".into())));
        }
        // Second commit is silent; setValue clears dirty (programmatic ≠ edit).
        view.commit_input_if_dirty(id);
        view.simulate_input(id, "y").unwrap();
        view.set_input_value(id, "reset");
        view.commit_input_if_dirty(id);
        assert_eq!(
            events.borrow().len(),
            4,
            "setValue-cleared dirty does not commit"
        );
    }

    #[test]
    fn commit_for_unknown_id_is_a_noop() {
        let (view, _) = host_with_input("hi");
        view.commit_input_if_dirty(ElementId(99));
    }
}

#[cfg(test)]
mod key_binding_tests {
    use super::*;

    fn seqs(bindings: &[&str]) -> Vec<KeyBindingSeq> {
        bindings.iter().map(|b| parse_binding(b).unwrap()).collect()
    }

    #[test]
    fn tokens_canonicalize_aliases_and_case() {
        assert_eq!(
            canonical_token("Ctrl-Shift-P").as_deref(),
            Some("ctrl-shift-p")
        );
        assert_eq!(canonical_token("Meta-K").as_deref(), Some("cmd-k"));
        assert_eq!(canonical_token("Option-F").as_deref(), Some("alt-f"));
        assert_eq!(canonical_token("escape").as_deref(), Some("escape"));
        assert_eq!(
            canonical_token("ctrl").as_deref(),
            None,
            "modifier-only is not a keystroke"
        );
        assert!(canonical_token("a-b").is_none(), "two key parts rejected");
    }

    #[test]
    fn single_binding_fires_on_exact_keystroke() {
        let b = seqs(&["cmd-k", "escape"]);
        let mut pending = None;
        assert_eq!(advance_binding(&b, &mut pending, "escape"), Some(1));
        assert_eq!(advance_binding(&b, &mut pending, "cmd-k"), Some(0));
        assert!(pending.is_none());
        // Wrong key never fires.
        assert!(advance_binding(&b, &mut pending, "x").is_none());
    }

    #[test]
    fn sequence_requires_order_and_resets_on_mismatch() {
        let b = seqs(&["ctrl-x ctrl-s"]);
        let mut pending = None;
        assert_eq!(advance_binding(&b, &mut pending, "ctrl-x"), None);
        assert_eq!(pending, Some((0, 1)));
        // Wrong second key: reset, and this key fresh-matches nothing.
        assert_eq!(advance_binding(&b, &mut pending, "z"), None);
        assert!(pending.is_none());
        // Correct order fires on completion.
        assert_eq!(advance_binding(&b, &mut pending, "ctrl-x"), None);
        assert_eq!(advance_binding(&b, &mut pending, "ctrl-s"), Some(0));
    }

    #[test]
    fn canonical_keystroke_matches_binding_form() {
        let ks = gpui::Keystroke {
            modifiers: gpui::Modifiers {
                control: true,
                shift: true,
                ..Default::default()
            },
            key: "P".into(),
            key_char: None,
        };
        assert_eq!(canonical_keystroke(&ks), "ctrl-shift-p");
        let b = seqs(&["control-shift-p"]);
        let mut pending = None;
        assert_eq!(
            advance_binding(&b, &mut pending, &canonical_keystroke(&ks)),
            Some(0)
        );
    }
}

#[cfg(test)]
mod key_binding_review_tests {
    use super::*;

    fn seqs(bindings: &[&str]) -> Vec<KeyBindingSeq> {
        bindings.iter().map(|b| parse_binding(b).unwrap()).collect()
    }

    #[test]
    fn binding_swap_mid_sequence_never_panics() {
        // r1 Blocker 2: pending (0,1) + a re-render that swaps the list to a
        // SHORTER binding at the same index must reset, not index OOB.
        let before = seqs(&["ctrl-x ctrl-s"]);
        let after = seqs(&["cmd-k"]);
        let mut pending = None;
        assert_eq!(advance_binding(&before, &mut pending, "ctrl-x"), None);
        assert_eq!(pending, Some((0, 1)));
        // Same index, shorter sequence: seq.0[1] would panic pre-fix.
        assert_eq!(advance_binding(&after, &mut pending, "k"), None);
        // Reset happened; a fresh cmd-k still fires normally.
        assert_eq!(advance_binding(&after, &mut pending, "cmd-k"), Some(0));
    }

    #[test]
    fn prefix_sharing_semantics_first_binding_wins() {
        // r1 Major: with "ctrl-x" bound alone AND as a sequence prefix, the
        // FIRST entry wins per keystroke and the other can never fire. This
        // pins the chosen deterministic semantics (renderer warns at install
        // time); change this test only together with that decision.
        let b = seqs(&["ctrl-x", "ctrl-x ctrl-s"]);
        let mut pending = None;
        assert_eq!(advance_binding(&b, &mut pending, "ctrl-x"), Some(0));
        assert!(pending.is_none());
        assert_eq!(advance_binding(&b, &mut pending, "ctrl-s"), None);

        // Reverse order: the chord owns ctrl-x; the lone binding is dead.
        let b2 = seqs(&["ctrl-x ctrl-s", "ctrl-x"]);
        let mut pending2 = None;
        assert_eq!(advance_binding(&b2, &mut pending2, "ctrl-x"), None);
        assert_eq!(pending2, Some((0, 1)));
        assert_eq!(advance_binding(&b2, &mut pending2, "ctrl-s"), Some(0));
    }
}

#[cfg(test)]
mod list_alignment_tests {
    use super::*;

    fn node_with(styles: &[(&str, StyleValue)]) -> solid_gpui_protocol::Node {
        let mut tree = solid_gpui_protocol::RetainedTree::new();
        tree.apply(&Mutation::CreateElement {
            id: ElementId(1),
            element_type: ElementType::List,
        })
        .unwrap();
        tree.apply(&Mutation::SetStyle {
            id: ElementId(1),
            style: styles
                .iter()
                .map(|(k, v)| (k.to_string(), v.clone()))
                .collect(),
            state: None,
        })
        .unwrap();
        tree.get(ElementId(1)).unwrap().clone()
    }

    #[test]
    fn align_resolution_prefers_explicit_list_align() {
        use gpui::ListAlignment;
        // Default: top.
        assert_eq!(resolve_list_alignment(&node_with(&[])), ListAlignment::Top);
        // followTail implies bottom (back-compat, pre-P5 semantic).
        assert_eq!(
            resolve_list_alignment(&node_with(&[(
                "followTail",
                StyleValue::Text("true".into())
            )])),
            ListAlignment::Bottom
        );
        // Explicit listAlign wins over the followTail fallback, both ways.
        assert_eq!(
            resolve_list_alignment(&node_with(&[
                ("listAlign", StyleValue::Text("bottom".into())),
                ("followTail", StyleValue::Text("true".into())),
            ])),
            ListAlignment::Bottom
        );
        assert_eq!(
            resolve_list_alignment(&node_with(&[("listAlign", StyleValue::Text("top".into()))])),
            ListAlignment::Top
        );
        // Unknown value falls back to the followTail rule (open-value rule).
        assert_eq!(
            resolve_list_alignment(&node_with(&[(
                "listAlign",
                StyleValue::Text("middle".into())
            )])),
            ListAlignment::Top
        );
    }
}
