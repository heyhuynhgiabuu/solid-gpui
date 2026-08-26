//! The retained element tree: protocol mutations applied to owned data.
//!
//! Pure data with validation — no gpui, no IO. The helper's GPUI view reads
//! this tree each frame; the JS side never sees it. Semantics (Slice 4):
//!
//! - `appendChild`/`insertBefore` require the child to be parentless AND not
//!   an ancestor of the new parent (an ancestor walk makes cycles
//!   impossible in both arms). Appending an element to itself is an error.
//!   Tree depth is capped at `MAX_DEPTH` to keep render recursion bounded.
//! - Children cannot be attached to text-type elements (plain strings) nor
//!   to input/textarea (dedicated element with no child slots); validation
//!   and rendering agree.
//! - `removeChild` detaches but keeps the element (and its subtree) alive for
//!   re-append; `destroyElement` permanently removes the subtree and returns
//!   the destroyed ids (callers clean up event listeners with them). If the
//!   destroyed subtree contains the current root, the root is cleared.
//! - `setRoot` requires an existing element and may replace a previous root
//!   (the `bun --hot` remount pattern swaps roots on a live window).
//! - `setText` is valid on text elements (plain string) and markdown
//!   elements (the markdown source the helper parses and renders).
//! - Destroying the current root clears it; the window shows nothing until a
//!   new root is set.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::{
    ApplyError, ElementId, ElementType, EventType, Mutation, StyleMap, StyleState, StyleValue,
};

pub const MAX_DEPTH: usize = 256;

/// One retained host element.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub element_type: ElementType,
    pub style: StyleMap,
    /// Key bindings (shortcuts/sequences) — fired as `keys` events while
    /// the element holds focus. Empty = none.
    pub key_bindings: Vec<String>,
    /// State-layer styles (hover/active) layered on top of `style` when the
    /// helper reports the matching interaction state. Markdown nodes reject
    /// state layers entirely — their render path is helper-owned and would
    /// silently drop them (validation and rendering agree).
    pub state_styles: BTreeMap<StyleState, StyleMap>,
    pub text: Option<String>,
    /// Input/textarea document value (setValue). Present only on
    /// input/textarea elements; validation and rendering agree.
    pub value: Option<String>,
    pub children: Vec<ElementId>,
    pub parent: Option<ElementId>,
    pub listeners: BTreeSet<EventType>,
}

impl Node {
    fn new(element_type: ElementType) -> Self {
        Node {
            element_type,
            style: BTreeMap::new(),
            key_bindings: Vec::new(),
            state_styles: BTreeMap::new(),
            text: None,
            value: None,
            children: Vec::new(),
            parent: None,
            listeners: BTreeSet::new(),
        }
    }
}

/// The retained tree owned by the helper's GPUI view.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RetainedTree {
    elements: HashMap<ElementId, Node>,
    root: Option<ElementId>,
}

impl RetainedTree {
    pub fn new() -> Self {
        RetainedTree::default()
    }

    pub fn root(&self) -> Option<ElementId> {
        self.root
    }

    pub fn get(&self, id: ElementId) -> Option<&Node> {
        self.elements.get(&id)
    }

    /// Apply one mutation. Fails without partial side effects on that
    /// mutation (validated before any write).
    pub fn apply(&mut self, mutation: &Mutation) -> Result<(), ApplyError> {
        match mutation {
            Mutation::CreateElement { id, element_type } => {
                if self.elements.contains_key(id) {
                    return Err(ApplyError::InvalidMutation {
                        message: format!("element {id:?} already exists"),
                    });
                }
                self.elements.insert(*id, Node::new(*element_type));
                Ok(())
            }
            Mutation::DestroyElement { id } => {
                if !self.elements.contains_key(id) {
                    return Err(ApplyError::InvalidMutation {
                        message: format!("destroyElement: no element {id:?}"),
                    });
                }
                self.destroy_subtree(*id)?;
                Ok(())
            }
            Mutation::AppendChild {
                parent_id,
                child_id,
            } => self.attach(*parent_id, *child_id, None),
            Mutation::RemoveChild {
                parent_id,
                child_id,
            } => {
                let child = self.child_of(*parent_id, *child_id)?;
                self.elements
                    .get_mut(&child.parent.expect("checked parent"))
                    .unwrap()
                    .children
                    .retain(|c| *c != *child_id);
                self.elements.get_mut(child_id).unwrap().parent = None;
                Ok(())
            }
            Mutation::InsertBefore {
                parent_id,
                child_id,
                before_id,
            } => self.attach(*parent_id, *child_id, Some(*before_id)),
            Mutation::SetStyle { id, style, state } => {
                let node = self.mut_node(*id, "setStyle")?;
                match state {
                    None => node.style = style.clone(),
                    Some(state) => {
                        if node.element_type == ElementType::Markdown {
                            return Err(ApplyError::InvalidMutation {
                                message: format!(
                                    "setStyle: markdown elements render base styles only ({id:?})"
                                ),
                            });
                        }
                        node.state_styles.insert(*state, style.clone());
                    }
                }
                Ok(())
            }
            Mutation::SetAnimation {
                id,
                target,
                transition_ms: _,
                easing,
            } => {
                let node = self.mut_node(*id, "setAnimation")?;
                if node.element_type == ElementType::Markdown {
                    // Validation and rendering agree: markdown reads only the
                    // static color/backgroundColor/fontSize style — there is no
                    // interpolation path, so animation must fail honestly
                    // instead of acking and silently doing nothing.
                    return Err(ApplyError::InvalidMutation {
                        message: format!(
                            "setAnimation: markdown elements render static styles only ({id:?})"
                        ),
                    });
                }
                let easing_name = easing.as_deref().unwrap_or("easeOut");
                if crate::Easing::parse(easing_name).is_none() {
                    return Err(ApplyError::InvalidMutation {
                        message: format!(
                            "setAnimation: unknown easing {easing_name:?}; expected linear|easeIn|easeOut|easeInOut"
                        ),
                    });
                }
                for (key, value) in target {
                    if !crate::ANIMATABLE_STYLE_KEYS.contains(&key.as_str()) {
                        return Err(ApplyError::InvalidMutation {
                            message: format!(
                                "setAnimation: {key:?} is not animatable; expected one of {}",
                                crate::ANIMATABLE_STYLE_KEYS.join("|")
                            ),
                        });
                    }
                    let to = match value {
                        StyleValue::Number(n) => n.as_f64(),
                        StyleValue::Text(_) => None,
                    };
                    let Some(to) = to else {
                        return Err(ApplyError::InvalidMutation {
                            message: format!(
                                "setAnimation: target {key:?} must be numeric, got {value:?}"
                            ),
                        });
                    };
                    let from = match node.style.get(key) {
                        Some(StyleValue::Number(n)) => n.as_f64(),
                        _ => None,
                    };
                    let Some(_from) = from else {
                        return Err(ApplyError::InvalidMutation {
                            message: format!(
                                "setAnimation: element {id:?} has no numeric start for {key:?}; set it via setStyle first"
                            ),
                        });
                    };
                    // End state sticks: merge the target into the static
                    // style so the element rests there once (or without)
                    // animation running.
                    let to_number = serde_json::Number::from_f64(to).ok_or_else(|| {
                        ApplyError::InvalidMutation {
                            message: format!("setAnimation: target {key:?} is not a finite number"),
                        }
                    })?;
                    node.style
                        .insert(key.clone(), StyleValue::Number(to_number));
                }
                Ok(())
            }
            Mutation::SetKeyBindings { id, bindings } => {
                let node = self.mut_node(*id, "setKeyBindings")?;
                if node.element_type == ElementType::Markdown {
                    // Validation and rendering agree: markdown renders a
                    // static helper-owned subtree and fires no events.
                    return Err(ApplyError::InvalidMutation {
                        message: format!(
                            "setKeyBindings: markdown elements fire no events ({id:?})"
                        ),
                    });
                }
                node.key_bindings = bindings.clone();
                Ok(())
            }
            Mutation::SetText { id, text } => {
                let node = self.mut_node(*id, "setText")?;
                if !matches!(node.element_type, ElementType::Text | ElementType::Markdown) {
                    return Err(ApplyError::InvalidMutation {
                        message: format!(
                            "setText: element {id:?} is not a text or markdown element"
                        ),
                    });
                }
                node.text = Some(text.clone());
                Ok(())
            }
            Mutation::SetValue { id, value } => {
                let node = self.mut_node(*id, "setValue")?;
                if !matches!(
                    node.element_type,
                    ElementType::Input | ElementType::Textarea
                ) {
                    return Err(ApplyError::InvalidMutation {
                        message: format!(
                            "setValue: element {id:?} is not an input/textarea element"
                        ),
                    });
                }
                node.value = Some(value.clone());
                Ok(())
            }
            Mutation::SetEventListener {
                id,
                event_type,
                enabled,
            } => {
                let node = self.mut_node(*id, "setEventListener")?;
                if node.element_type == ElementType::Markdown {
                    // Validation and rendering agree: markdown renders a
                    // helper-owned subtree and never wires listeners, so an
                    // acked listener would silently never fire.
                    return Err(ApplyError::InvalidMutation {
                        message: format!(
                            "setEventListener: markdown elements do not fire events ({id:?})"
                        ),
                    });
                }
                if *enabled {
                    node.listeners.insert(*event_type);
                } else {
                    node.listeners.remove(event_type);
                }
                Ok(())
            }
            Mutation::SetRoot { id } => {
                if !self.elements.contains_key(id) {
                    return Err(ApplyError::InvalidMutation {
                        message: format!("setRoot: no element {id:?} to become root"),
                    });
                }
                self.root = Some(*id);
                Ok(())
            }
        }
    }

    /// Permanently remove `id` and its whole subtree; detaches from its
    /// parent (or clears the root) first. Returns destroyed ids in
    /// parent-before-child order.
    pub fn destroy_subtree(&mut self, id: ElementId) -> Result<Vec<ElementId>, ApplyError> {
        if !self.elements.contains_key(&id) {
            return Err(ApplyError::InvalidMutation {
                message: format!("destroyElement: no element {id:?}"),
            });
        }
        if let Some(parent) = self.elements.get(&id).and_then(|n| n.parent)
            && let Some(p) = self.elements.get_mut(&parent)
        {
            p.children.retain(|c| *c != id);
        }
        if self.root == Some(id) {
            self.root = None;
        }
        let mut destroyed = Vec::new();
        let mut stack = vec![id];
        while let Some(cur) = stack.pop() {
            if let Some(node) = self.elements.remove(&cur) {
                if self.root == Some(cur) {
                    self.root = None;
                }
                destroyed.push(cur);
                stack.extend(node.children.iter().copied());
            }
        }
        Ok(destroyed)
    }

    /// Shared append/insert. Appending requires the child to be parentless
    /// (cycles are then structurally impossible; re-parent via `removeChild`
    /// first). `insertBefore` may additionally REPOSITION a child that already
    /// belongs to the same parent — DOM insertBefore semantics, exercised by
    /// the shared fixture. `before` must be an existing child of the parent.
    fn attach(
        &mut self,
        parent_id: ElementId,
        child_id: ElementId,
        before_id: Option<ElementId>,
    ) -> Result<(), ApplyError> {
        if !self.elements.contains_key(&parent_id) {
            return Err(ApplyError::InvalidMutation {
                message: format!("parent {parent_id:?} does not exist"),
            });
        }
        // Validation and rendering agree: text renders as a plain string,
        // input/textarea render as a dedicated element with no child slots,
        // and markdown renders the source text into its own helper-owned
        // subtree — in all cases the renderer would silently drop wire
        // children, so reject them.
        if matches!(
            self.elements.get(&parent_id).unwrap().element_type,
            ElementType::Text | ElementType::Input | ElementType::Textarea | ElementType::Markdown
        ) {
            return Err(ApplyError::InvalidMutation {
                message: format!(
                    "cannot attach children to element {parent_id:?} (no child slots)"
                ),
            });
        }
        // Scrollbar drives EXACTLY ONE scrollable child: the helper binds
        // the bar to that child's scroll handle; a second child would be
        // silently undriven (validation and rendering agree).
        if self.elements.get(&parent_id).unwrap().element_type == ElementType::Scrollbar
            && !self.elements.get(&parent_id).unwrap().children.is_empty()
        {
            return Err(ApplyError::InvalidMutation {
                message: format!(
                    "scrollbar {parent_id:?} already wraps one scrollable; one bar, one target"
                ),
            });
        }
        let Some(child) = self.elements.get(&child_id) else {
            return Err(ApplyError::InvalidMutation {
                message: format!("child {child_id:?} does not exist"),
            });
        };
        match child.parent {
            None => {}
            Some(p) if p == parent_id && before_id.is_some() => {
                // DOM-style reposition within the same parent: legal for
                // insertBefore only (appendChild stays strict).
            }
            Some(p) => {
                return Err(ApplyError::InvalidMutation {
                    message: format!(
                        "child {child_id:?} already has a parent ({p:?}); removeChild first"
                    ),
                });
            }
        }
        if parent_id == child_id {
            return Err(ApplyError::InvalidMutation {
                message: format!("element {child_id:?} cannot be appended to itself"),
            });
        }
        // Ancestor check: appending an ancestor (e.g. the parentless root)
        // under its own descendant would create a cycle. The walk is also the
        // depth measure — bounded by MAX_DEPTH to keep render recursion safe.
        let mut depth = 0usize;
        let mut cur = parent_id;
        loop {
            if cur == child_id {
                return Err(ApplyError::InvalidMutation {
                    message: format!(
                        "child {child_id:?} is an ancestor of parent {parent_id:?}; that would create a cycle"
                    ),
                });
            }
            depth += 1;
            if depth >= MAX_DEPTH {
                // Child would sit at depth > MAX_DEPTH; render recursion stays
                // bounded. (Also a backstop: a cycle walks ancestors forever.)
                return Err(ApplyError::InvalidMutation {
                    message: format!("tree depth would exceed {MAX_DEPTH}"),
                });
            }
            match self.elements.get(&cur).and_then(|n| n.parent) {
                Some(p) => cur = p,
                None => break,
            }
        }
        let pos = match before_id {
            None => None,
            Some(before) => {
                let parent_node = self.elements.get(&parent_id).expect("checked above");
                let Some(pos) = parent_node.children.iter().position(|c| *c == before) else {
                    return Err(ApplyError::InvalidMutation {
                        message: format!(
                            "insertBefore: {before:?} is not a child of parent {parent_id:?}"
                        ),
                    });
                };
                Some(pos)
            }
        };
        {
            let parent_node = self.elements.get_mut(&parent_id).expect("checked above");
            // Remove any prior occurrence (reposition case) before inserting.
            parent_node.children.retain(|c| *c != child_id);
            match pos {
                Some(p) => parent_node.children.insert(p, child_id),
                None => parent_node.children.push(child_id),
            }
        }
        self.elements
            .get_mut(&child_id)
            .expect("checked above")
            .parent = Some(parent_id);
        Ok(())
    }

    /// Validate that `child_id` is currently a child of `parent_id`.
    fn child_of(&self, parent_id: ElementId, child_id: ElementId) -> Result<&Node, ApplyError> {
        let parent = self
            .elements
            .get(&parent_id)
            .ok_or_else(|| ApplyError::InvalidMutation {
                message: format!("removeChild: no parent {parent_id:?}"),
            })?;
        if !parent.children.contains(&child_id) {
            return Err(ApplyError::InvalidMutation {
                message: format!("removeChild: {child_id:?} is not a child of {parent_id:?}"),
            });
        }
        self.elements
            .get(&child_id)
            .ok_or_else(|| ApplyError::InvalidMutation {
                message: format!("removeChild: no child {child_id:?}"),
            })
    }

    fn mut_node(&mut self, id: ElementId, op: &str) -> Result<&mut Node, ApplyError> {
        self.elements
            .get_mut(&id)
            .ok_or_else(|| ApplyError::InvalidMutation {
                message: format!("{op}: no element {id:?}"),
            })
    }
}
