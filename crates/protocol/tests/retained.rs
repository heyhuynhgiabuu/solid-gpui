//! RetainedTree semantics: the shared fixture applies completely, the final
//! shape matches the mutation sequence, and invalid sequences fail with
//! precise errors. Pure data — no gpui, no IO.

use solid_gpui_protocol::{
    ApplyError, DrawItem, ElementId, ElementType, EventType, Mutation, RetainedTree, StyleMap,
    StyleState, StyleValue, TextRun, TextRunStyle, from_json,
};
use std::fs;

fn fixture_batch() -> Vec<Mutation> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/protocol/fixtures/batch-01.json");
    let raw = fs::read_to_string(path).expect("fixture readable");
    from_json(&raw).expect("fixture parses").mutations
}

fn apply_all(tree: &mut RetainedTree, mutations: &[Mutation]) -> Result<(), ApplyError> {
    for m in mutations {
        tree.apply(m)?;
    }
    Ok(())
}

#[test]
fn fixture_applies_fully_to_expected_shape() {
    let mutations = fixture_batch();
    let mut tree = RetainedTree::new();
    apply_all(&mut tree, &mutations).expect("fixture applies cleanly");

    assert_eq!(tree.root().map(|id| id.0), Some(1));
    let root = tree.get(1.into()).expect("root node exists");
    assert_eq!(root.element_type, ElementType::Div);
    // insertBefore(3 before 2) then removeChild(3) → children == [2]
    assert_eq!(root.children, vec![2.into()]);

    let text = tree.get(2.into()).expect("text node exists");
    assert_eq!(text.element_type, ElementType::Text);
    assert_eq!(text.text.as_deref(), Some("Xin chào solid-gpui 🎉"));

    assert_eq!(
        root.style.get("display").and_then(|v| v.as_str()),
        Some("flex")
    );
    // 3 was destroyed (with its click listener)
    assert!(tree.get(3.into()).is_none());
    assert!(root.children.iter().all(|c| *c != 3.into()));
}

#[test]
fn destroy_element_returns_destroyed_subtree_ids() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 3.into(),
                element_type: ElementType::Text,
            },
            Mutation::AppendChild {
                parent_id: 1.into(),
                child_id: 2.into(),
            },
            Mutation::AppendChild {
                parent_id: 2.into(),
                child_id: 3.into(),
            },
        ],
    )
    .unwrap();

    let destroyed = tree.destroy_subtree(1.into()).expect("destroy root");
    assert_eq!(destroyed, vec![1.into(), 2.into(), 3.into()]);
    assert!(tree.get(1.into()).is_none());
    assert_eq!(tree.root(), None, "destroying the root clears it");
}

#[test]
fn append_to_missing_parent_fails() {
    let mut tree = RetainedTree::new();
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: 9.into(),
            child_id: 1.into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("parent"), "got: {err}");
}

#[test]
fn append_child_that_already_has_a_parent_fails() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 3.into(),
                element_type: ElementType::Div,
            },
            Mutation::AppendChild {
                parent_id: 1.into(),
                child_id: 2.into(),
            },
        ],
    )
    .unwrap();
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: 3.into(),
            child_id: 2.into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("already"), "got: {err}");
}

#[test]
fn appending_an_element_to_itself_fails() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: 1.into(),
        element_type: ElementType::Div,
    })
    .unwrap();
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: 1.into(),
            child_id: 1.into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("itself"), "got: {err}");
}

#[test]
fn insert_before_must_reference_a_child_of_the_parent() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Text,
            },
        ],
    )
    .unwrap();
    // 2 is NOT a child of 1 yet
    let err = tree
        .apply(&Mutation::InsertBefore {
            parent_id: 1.into(),
            child_id: 2.into(),
            before_id: 2.into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("insertBefore"), "got: {err}");
}

#[test]
fn remove_child_must_match_actual_parent() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 3.into(),
                element_type: ElementType::Text,
            },
        ],
    )
    .unwrap();
    let err = tree
        .apply(&Mutation::RemoveChild {
            parent_id: 1.into(),
            child_id: 3.into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("child of"), "got: {err}");
}

#[test]
fn remove_child_keeps_element_alive_for_reappend() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Text,
            },
            Mutation::AppendChild {
                parent_id: 1.into(),
                child_id: 2.into(),
            },
            Mutation::RemoveChild {
                parent_id: 1.into(),
                child_id: 2.into(),
            },
        ],
    )
    .unwrap();
    assert!(tree.get(2.into()).is_some(), "element survives removal");
    assert!(tree.get(1.into()).unwrap().children.is_empty());
    // re-append works
    tree.apply(&Mutation::AppendChild {
        parent_id: 1.into(),
        child_id: 2.into(),
    })
    .expect("re-append after remove");
}

#[test]
fn set_root_requires_existing_element_and_can_replace() {
    let mut tree = RetainedTree::new();
    let err = tree.apply(&Mutation::SetRoot { id: 7.into() }).unwrap_err();
    assert!(err.to_string().contains("root"), "got: {err}");

    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::SetRoot { id: 1.into() },
        ],
    )
    .unwrap();
    // Replaceable: bun --hot remounts send a fresh root on the same window.
    apply_all(
        &mut tree,
        &[Mutation::CreateElement {
            id: 8.into(),
            element_type: ElementType::Div,
        }],
    )
    .unwrap();
    tree.apply(&Mutation::SetRoot { id: 8.into() })
        .expect("second setRoot replaces");
    assert_eq!(tree.root(), Some(8.into()));
}

#[test]
fn set_text_requires_text_type_element() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: 1.into(),
        element_type: ElementType::Div,
    })
    .unwrap();
    let err = tree
        .apply(&Mutation::SetText {
            id: 1.into(),
            text: "nope".into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("text"), "got: {err}");
}

#[test]
fn set_text_runs_replaces_text_and_clears_on_plain_text() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[Mutation::CreateElement {
            id: 1.into(),
            element_type: ElementType::Text,
        }],
    )
    .unwrap();

    tree.apply(&Mutation::SetTextRuns {
        id: 1.into(),
        runs: vec![
            TextRun {
                text: "Hello ".into(),
                color: Some("#cdd6f4".into()),
                weight: Some(400),
                style: Some(TextRunStyle::Normal),
                underline: None,
            },
            TextRun {
                text: "世界 🌍".into(),
                color: Some("#89b4fa".into()),
                weight: Some(700),
                style: Some(TextRunStyle::Italic),
                underline: Some(true),
            },
        ],
    })
    .unwrap();
    let node = tree.get(1.into()).unwrap();
    assert_eq!(node.text.as_deref(), Some("Hello 世界 🌍"));
    assert_eq!(node.text_runs.as_ref().unwrap().len(), 2);

    tree.apply(&Mutation::SetText {
        id: 1.into(),
        text: "plain".into(),
    })
    .unwrap();
    let node = tree.get(1.into()).unwrap();
    assert_eq!(node.text.as_deref(), Some("plain"));
    assert_eq!(node.text_runs, None);
}

#[test]
fn set_text_runs_rejects_non_text_and_bad_weights() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[Mutation::CreateElement {
            id: 1.into(),
            element_type: ElementType::Div,
        }],
    )
    .unwrap();
    let run = TextRun {
        text: "x".into(),
        color: None,
        weight: Some(99),
        style: None,
        underline: None,
    };
    let err = tree
        .apply(&Mutation::SetTextRuns {
            id: 1.into(),
            runs: vec![run.clone()],
        })
        .unwrap_err();
    assert!(err.to_string().contains("text element"), "got: {err}");

    tree.apply(&Mutation::CreateElement {
        id: 2.into(),
        element_type: ElementType::Text,
    })
    .unwrap();
    let err = tree
        .apply(&Mutation::SetTextRuns {
            id: 2.into(),
            runs: vec![run],
        })
        .unwrap_err();
    assert!(err.to_string().contains("100..=900"), "got: {err}");
}

#[test]
fn set_listener_round_trips() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::SetEventListener {
                id: 1.into(),
                event_type: EventType::Click,
                enabled: true,
            },
            Mutation::SetEventListener {
                id: 1.into(),
                event_type: EventType::Click,
                enabled: false,
            },
        ],
    )
    .unwrap();
    assert!(
        !tree
            .get(1.into())
            .unwrap()
            .listeners
            .contains(&EventType::Click)
    );
}

#[test]
fn appending_ancestor_into_own_descendant_fails() {
    // The old hole: root is parentless, so appending it under its own child
    // passed validation and created a cycle (renderer would recurse forever).
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Div,
            },
            Mutation::AppendChild {
                parent_id: 1.into(),
                child_id: 2.into(),
            },
            Mutation::SetRoot { id: 1.into() },
        ],
    )
    .unwrap();
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: 2.into(),
            child_id: 1.into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("ancestor"), "got: {err}");
    // Same hole via insertBefore's parentless arm.
    apply_all(
        &mut tree,
        &[Mutation::CreateElement {
            id: 3.into(),
            element_type: ElementType::Div,
        }],
    )
    .unwrap();
    let err = tree
        .apply(&Mutation::InsertBefore {
            parent_id: 2.into(),
            child_id: 1.into(),
            before_id: 3.into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("ancestor"), "got: {err}");
}

#[test]
fn destroy_of_subtree_containing_root_clears_root() {
    // Destroying the root itself (any destroyed set containing it) must not
    // leave a dangling root. Destroying a mere child keeps the root alive.
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Div,
            },
            Mutation::AppendChild {
                parent_id: 1.into(),
                child_id: 2.into(),
            },
            Mutation::SetRoot { id: 1.into() },
        ],
    )
    .unwrap();
    tree.destroy_subtree(2.into()).unwrap();
    assert_eq!(tree.root(), Some(1.into()), "root survives a child destroy");
    assert!(tree.get(2.into()).is_none());
    assert!(tree.get(1.into()).unwrap().children.is_empty());

    tree.destroy_subtree(1.into()).unwrap();
    assert_eq!(tree.root(), None, "destroying the root clears it");
}

#[test]
fn appending_children_to_text_nodes_fails() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Text,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Div,
            },
        ],
    )
    .unwrap();
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: 1.into(),
            child_id: 2.into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("no child slots"), "got: {err}");
}

#[test]
fn depth_beyond_limit_is_rejected() {
    // Render recursion follows depth; a depth cap keeps the renderer's stack
    // bounded even for adversarial acyclic trees.
    let mut tree = RetainedTree::new();
    let mut mutations = Vec::new();
    for i in 1..=257u32 {
        mutations.push(Mutation::CreateElement {
            id: i.into(),
            element_type: ElementType::Div,
        });
        if i > 1 {
            mutations.push(Mutation::AppendChild {
                parent_id: (i - 1).into(),
                child_id: i.into(),
            });
        }
    }
    let mut ok = 0;
    for m in &mutations {
        if tree.apply(m).is_ok() {
            ok += 1;
        }
    }
    // All creates succeed; the 257th append (depth 257 > MAX_DEPTH 256) fails.
    assert_eq!(ok, mutations.len() - 1);
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: 256.into(),
            child_id: 257.into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("depth"), "got: {err}");
}

#[test]
fn mutations_on_missing_elements_fail() {
    let mut tree = RetainedTree::new();
    for m in [
        Mutation::DestroyElement { id: 5.into() },
        Mutation::SetStyle {
            id: 5.into(),
            style: Default::default(),
            state: None,
        },
        Mutation::SetText {
            id: 5.into(),
            text: "x".into(),
        },
        Mutation::SetEventListener {
            id: 5.into(),
            event_type: EventType::Click,
            enabled: true,
        },
    ] {
        assert!(tree.apply(&m).is_err(), "must fail: {m:?}");
    }
}

// The `{:?}` of ElementId is used in several error-message assertions above.

#[test]
fn children_of_input_and_textarea_are_rejected() {
    // The renderer drops input/textarea children (dedicated element), so
    // validation must reject them — the ack's applied count must not lie
    // (AGENTS invariant 1).
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Input,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Textarea,
            },
            Mutation::CreateElement {
                id: 3.into(),
                element_type: ElementType::Text,
            },
            Mutation::CreateElement {
                id: 4.into(),
                element_type: ElementType::Div,
            },
        ],
    )
    .unwrap();
    for parent in [1u32, 2] {
        let err = tree
            .apply(&Mutation::AppendChild {
                parent_id: parent.into(),
                child_id: 4.into(),
            })
            .unwrap_err();
        assert!(err.to_string().contains("no child slots"), "got: {err}");
    }
    // Text keeps rejecting too (pre-existing contract).
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: 3.into(),
            child_id: 4.into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("no child slots"), "got: {err}");
}

#[test]
fn set_value_on_input_and_textarea_stores_the_value() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Input,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Textarea,
            },
        ],
    )
    .unwrap();
    tree.apply(&Mutation::SetValue {
        id: 1.into(),
        value: "hello 🎉".into(),
    })
    .unwrap();
    tree.apply(&Mutation::SetValue {
        id: 2.into(),
        value: "line1\nline2".into(),
    })
    .unwrap();
    assert_eq!(
        tree.get(1.into()).unwrap().value.as_deref(),
        Some("hello 🎉")
    );
    assert_eq!(
        tree.get(2.into()).unwrap().value.as_deref(),
        Some("line1\nline2")
    );
}

#[test]
fn set_value_on_non_input_element_is_rejected() {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::CreateElement {
                id: 2.into(),
                element_type: ElementType::Text,
            },
        ],
    )
    .unwrap();
    for id in [1u32, 2] {
        let err = tree
            .apply(&Mutation::SetValue {
                id: id.into(),
                value: "x".into(),
            })
            .unwrap_err();
        assert!(
            err.to_string().contains("input/textarea"),
            "id {id} got: {err}"
        );
    }
}

fn num(v: f64) -> StyleValue {
    // Test helper: values here are always finite.
    StyleValue::Number(serde_json::Number::from_f64(v).unwrap())
}

/// Mount a div with numeric width/opacity so setAnimation has valid starts.
fn animated_tree() -> RetainedTree {
    let mut tree = RetainedTree::new();
    apply_all(
        &mut tree,
        &[
            Mutation::CreateElement {
                id: 1.into(),
                element_type: ElementType::Div,
            },
            Mutation::SetStyle {
                id: 1.into(),
                style: StyleMap::from([
                    ("width".to_string(), StyleValue::Number(200u32.into())),
                    ("opacity".to_string(), StyleValue::Number(1u32.into())),
                ]),
                state: None,
            },
        ],
    )
    .unwrap();
    tree
}

fn set_animation(target: StyleMap, easing: Option<String>) -> Mutation {
    Mutation::SetAnimation {
        id: 1.into(),
        target,
        transition_ms: 250,
        easing,
    }
}

#[test]
fn set_animation_merges_target_so_end_state_sticks() {
    let mut tree = animated_tree();
    tree.apply(&set_animation(
        StyleMap::from([
            ("width".to_string(), StyleValue::Number(300u32.into())),
            ("opacity".to_string(), num(0.5)),
        ]),
        Some("easeOut".to_string()),
    ))
    .unwrap();
    let style = &tree.get(1.into()).unwrap().style;
    // Targets are merged into the static style: once the animation finishes
    // (or without animation support at all) the element rests at the target.
    // Compare numerically: the merge stores f64 (serde_json numbers
    // distinguish 300 from 300.0).
    let merged = |key: &str| {
        style.get(key).and_then(|v| match v {
            StyleValue::Number(n) => n.as_f64(),
            _ => None,
        })
    };
    assert_eq!(merged("width"), Some(300.0));
    assert_eq!(merged("opacity"), Some(0.5));
}

#[test]
fn set_animation_rejects_keys_outside_the_closed_set() {
    let mut tree = animated_tree();
    // Style keys are forward-compatible for setStyle, but animation needs a
    // real numeric render path — the animatable set is CLOSED.
    let err = tree
        .apply(&set_animation(
            StyleMap::from([("display".to_string(), StyleValue::Text("flex".into()))]),
            None,
        ))
        .unwrap_err();
    assert!(err.to_string().contains("animatable"), "got: {err}");
}

#[test]
fn set_animation_rejects_non_numeric_targets() {
    let mut tree = animated_tree();
    let err = tree
        .apply(&set_animation(
            StyleMap::from([("width".to_string(), StyleValue::Text("200px".into()))]),
            None,
        ))
        .unwrap_err();
    assert!(err.to_string().contains("numeric"), "got: {err}");
}

#[test]
fn set_animation_requires_a_numeric_start_on_the_element() {
    let mut tree = animated_tree();
    // Interpolation needs a well-defined start: the key must already hold a
    // number (you can only animate what is set).
    // P1-d note: "padding" left the animatable list (the renderer expands
    // it to physical keys pre-wire), so this test animates paddingTop — the
    // key a real batch would now carry.
    let err = tree
        .apply(&set_animation(
            StyleMap::from([("paddingTop".to_string(), StyleValue::Number(8u32.into()))]),
            None,
        ))
        .unwrap_err();
    assert!(err.to_string().contains("start"), "got: {err}");
}

#[test]
fn set_animation_rejects_unknown_easing() {
    let mut tree = animated_tree();
    let err = tree
        .apply(&set_animation(
            StyleMap::from([("width".to_string(), StyleValue::Number(300u32.into()))]),
            Some("spring".to_string()),
        ))
        .unwrap_err();
    assert!(err.to_string().contains("easing"), "got: {err}");
}

// --- S13 markdown elements -------------------------------------------------

/// A markdown element mounts, receives setText (the markdown source), and
/// refuses children — the helper renders the source into its own subtree, so
/// wire children would be silently dropped (validation and rendering agree).
#[test]
fn markdown_element_accepts_set_text_and_rejects_children() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: solid_gpui_protocol::ElementType::Markdown,
    })
    .unwrap();
    tree.apply(&Mutation::SetText {
        id: ElementId(1),
        text: "# hello".into(),
    })
    .unwrap();

    tree.apply(&Mutation::CreateElement {
        id: ElementId(2),
        element_type: solid_gpui_protocol::ElementType::Div,
    })
    .unwrap();
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: ElementId(1),
            child_id: ElementId(2),
        })
        .unwrap_err();
    assert!(err.to_string().contains("no child slots"), "got: {err}");
}

/// `setValue` stays the controlled-input path: markdown content flows through
/// setText only.
#[test]
fn markdown_element_rejects_set_value() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: solid_gpui_protocol::ElementType::Markdown,
    })
    .unwrap();
    let err = tree
        .apply(&Mutation::SetValue {
            id: ElementId(1),
            value: "nope".into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("input/textarea"), "got: {err}");
}

/// Listeners on markdown are rejected: the renderer never wires them, so an
/// ack would be a lie (validation/rendering agreement).
#[test]
fn markdown_element_rejects_set_event_listener() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: ElementType::Markdown,
    })
    .unwrap();
    let err = tree
        .apply(&Mutation::SetEventListener {
            id: ElementId(1),
            event_type: EventType::Click,
            enabled: true,
        })
        .unwrap_err();
    assert!(err.to_string().contains("markdown"), "got: {err}");
}

/// Animation on markdown is rejected: only static color/backgroundColor/
/// fontSize are read, so interpolation would silently no-op.
#[test]
fn markdown_element_rejects_set_animation() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: ElementType::Markdown,
    })
    .unwrap();
    tree.apply(&Mutation::SetStyle {
        id: ElementId(1),
        style: StyleMap::from([("fontSize".to_string(), StyleValue::Number(14u32.into()))]),
        state: None,
    })
    .unwrap();
    let err = tree
        .apply(&Mutation::SetAnimation {
            id: ElementId(1),
            target: StyleMap::from([("fontSize".to_string(), StyleValue::Number(28u32.into()))]),
            transition_ms: 100,
            easing: None,
        })
        .unwrap_err();
    assert!(err.to_string().contains("markdown"), "got: {err}");
}

#[test]
fn state_styles_layer_and_markdown_rejects_them() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: ElementType::Div,
    })
    .unwrap();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(2),
        element_type: ElementType::Markdown,
    })
    .unwrap();

    // State layer lands in state_styles, not the base map.
    tree.apply(&Mutation::SetStyle {
        id: ElementId(1),
        style: StyleMap::from([(
            "backgroundColor".to_string(),
            StyleValue::Text("#ff0000".into()),
        )]),
        state: Some(StyleState::Hover),
    })
    .unwrap();
    let node = tree.get(ElementId(1)).unwrap();
    assert!(
        node.style.is_empty(),
        "hover layer must not touch base style"
    );
    assert_eq!(
        node.state_styles.get(&StyleState::Hover).unwrap()["backgroundColor"],
        StyleValue::Text("#ff0000".into())
    );

    // Re-setting the same state replaces (idempotent per-state).
    tree.apply(&Mutation::SetStyle {
        id: ElementId(1),
        style: StyleMap::from([(
            "backgroundColor".to_string(),
            StyleValue::Text("#00ff00".into()),
        )]),
        state: Some(StyleState::Hover),
    })
    .unwrap();
    assert_eq!(
        tree.get(ElementId(1)).unwrap().state_styles[&StyleState::Hover]["backgroundColor"],
        StyleValue::Text("#00ff00".into())
    );

    // Markdown: validation and rendering agree — base styles only.
    let err = tree
        .apply(&Mutation::SetStyle {
            id: ElementId(2),
            style: StyleMap::from([(
                "backgroundColor".to_string(),
                StyleValue::Text("#ff0000".into()),
            )]),
            state: Some(StyleState::Hover),
        })
        .unwrap_err();
    assert!(
        err.to_string().contains("markdown"),
        "markdown state style must be rejected: {err}"
    );
    // ...while base styles on markdown remain valid.
    tree.apply(&Mutation::SetStyle {
        id: ElementId(2),
        style: StyleMap::from([(
            "backgroundColor".to_string(),
            StyleValue::Text("#ff0000".into()),
        )]),
        state: None,
    })
    .unwrap();
}

#[test]
fn key_bindings_store_and_markdown_rejects() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: ElementType::Div,
    })
    .unwrap();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(2),
        element_type: ElementType::Markdown,
    })
    .unwrap();

    tree.apply(&Mutation::SetKeyBindings {
        id: ElementId(1),
        bindings: vec!["cmd-k".into(), "ctrl-x ctrl-s".into()],
    })
    .unwrap();
    assert_eq!(
        tree.get(ElementId(1)).unwrap().key_bindings,
        vec!["cmd-k".to_string(), "ctrl-x ctrl-s".to_string()]
    );

    // Replace, and empty clears.
    tree.apply(&Mutation::SetKeyBindings {
        id: ElementId(1),
        bindings: vec![],
    })
    .unwrap();
    assert!(tree.get(ElementId(1)).unwrap().key_bindings.is_empty());

    let err = tree
        .apply(&Mutation::SetKeyBindings {
            id: ElementId(2),
            bindings: vec!["cmd-k".into()],
        })
        .unwrap_err();
    assert!(
        err.to_string().contains("markdown"),
        "markdown key bindings must be rejected: {err}"
    );
}

#[test]
fn scrollbar_requires_exactly_one_scrollable_child() {
    let mut tree = RetainedTree::new();

    // Zero children: rejected (the bar must wrap a scrollable).
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: ElementType::Scrollbar,
    })
    .unwrap();
    tree.apply(&Mutation::SetRoot { id: ElementId(1) }).unwrap();
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: ElementId(2),
            child_id: ElementId(1),
        })
        .unwrap_err();
    assert!(
        err.to_string().contains("exist"),
        "parent-missing fires first"
    );

    // One div child with overflow: OK.
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: ElementType::Scrollbar,
    })
    .unwrap();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(2),
        element_type: ElementType::Div,
    })
    .unwrap();
    tree.apply(&Mutation::SetStyle {
        id: ElementId(2),
        style: StyleMap::from([("overflow".to_string(), StyleValue::Text("scroll".into()))]),
        state: None,
    })
    .unwrap();
    tree.apply(&Mutation::AppendChild {
        parent_id: ElementId(1),
        child_id: ElementId(2),
    })
    .unwrap();
    assert_eq!(tree.get(ElementId(1)).unwrap().children, vec![ElementId(2)]);

    // A SECOND child: rejected — the bar drives exactly one scrollable.
    tree.apply(&Mutation::CreateElement {
        id: ElementId(3),
        element_type: ElementType::Div,
    })
    .unwrap();
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: ElementId(1),
            child_id: ElementId(3),
        })
        .unwrap_err();
    assert!(
        err.to_string().contains("scrollbar"),
        "second child must be rejected: {err}"
    );
}

#[test]
fn set_drag_data_stores_clears_and_markdown_rejects() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: ElementType::Div,
    })
    .unwrap();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(2),
        element_type: ElementType::Markdown,
    })
    .unwrap();

    tree.apply(&Mutation::SetDragData {
        id: ElementId(1),
        data: r#"{"itemId":42}"#.into(),
    })
    .unwrap();
    assert_eq!(
        tree.get(ElementId(1)).unwrap().drag_data.as_deref(),
        Some(r#"{"itemId":42}"#)
    );
    // Empty string clears.
    tree.apply(&Mutation::SetDragData {
        id: ElementId(1),
        data: String::new(),
    })
    .unwrap();
    assert_eq!(tree.get(ElementId(1)).unwrap().drag_data, None);

    let err = tree
        .apply(&Mutation::SetDragData {
            id: ElementId(2),
            data: "x".into(),
        })
        .unwrap_err();
    assert!(
        err.to_string().contains("markdown"),
        "markdown drag data must be rejected: {err}"
    );
}

#[test]
fn canvas_draw_list_replaces_and_rejects() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: ElementType::Canvas,
    })
    .unwrap();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(2),
        element_type: ElementType::Div,
    })
    .unwrap();

    // Replace-wholesale: second set replaces the first, not appends.
    let first = vec![DrawItem::Rect {
        x: 0.,
        y: 0.,
        w: 10.,
        h: 10.,
        color: "#000000".into(),
        corner_radius: None,
    }];
    tree.apply(&Mutation::SetDrawList {
        id: ElementId(1),
        items: first.clone(),
    })
    .unwrap();
    let second = vec![
        DrawItem::Path {
            points: vec![0., 0., 5., 5., 10., 0.],
            color: "#ff0000".into(),
            stroke_width: Some(2.),
            closed: Some(true),
        },
        DrawItem::Text {
            x: 1.,
            y: 2.,
            text: "hi".into(),
            size: 13.,
            color: "#ffffff".into(),
        },
    ];
    tree.apply(&Mutation::SetDrawList {
        id: ElementId(1),
        items: second.clone(),
    })
    .unwrap();
    assert_eq!(tree.get(ElementId(1)).unwrap().draw_list, second);
    assert_ne!(tree.get(ElementId(1)).unwrap().draw_list, first);

    // Non-canvas target rejects.
    let err = tree
        .apply(&Mutation::SetDrawList {
            id: ElementId(2),
            items: vec![],
        })
        .unwrap_err();
    assert!(err.to_string().contains("not a canvas"), "{err}");

    // Newline in a text item rejects (shape_line is single-line).
    let err = tree
        .apply(&Mutation::SetDrawList {
            id: ElementId(1),
            items: vec![DrawItem::Text {
                x: 0.,
                y: 0.,
                text: "two\nlines".into(),
                size: 12.,
                color: "#ffffff".into(),
            }],
        })
        .unwrap_err();
    assert!(err.to_string().contains("single-line"), "{err}");

    // Odd-length flat points reject.
    let err = tree
        .apply(&Mutation::SetDrawList {
            id: ElementId(1),
            items: vec![DrawItem::Path {
                points: vec![0., 0., 5.],
                color: "#ffffff".into(),
                stroke_width: None,
                closed: None,
            }],
        })
        .unwrap_err();
    assert!(err.to_string().contains("x,y pairs"), "{err}");
}

#[test]
fn canvas_rejects_children_and_interactive_props() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: ElementType::Canvas,
    })
    .unwrap();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(2),
        element_type: ElementType::Div,
    })
    .unwrap();

    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: ElementId(1),
            child_id: ElementId(2),
        })
        .unwrap_err();
    assert!(err.to_string().contains("no child slots"), "{err}");

    let err = tree
        .apply(&Mutation::SetEventListener {
            id: ElementId(1),
            event_type: EventType::Click,
            enabled: true,
        })
        .unwrap_err();
    assert!(err.to_string().contains("canvas"), "{err}");

    let err = tree
        .apply(&Mutation::SetDragData {
            id: ElementId(1),
            data: "x".into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("canvas"), "{err}");

    // Empty draw list is fine (clears the canvas).
    tree.apply(&Mutation::SetDrawList {
        id: ElementId(1),
        items: vec![],
    })
    .unwrap();
    assert!(tree.get(ElementId(1)).unwrap().draw_list.is_empty());
}

#[test]
fn media_elements_store_sources_and_reject_misuse() {
    let mut tree = RetainedTree::new();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(1),
        element_type: ElementType::Img,
    })
    .unwrap();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(2),
        element_type: ElementType::Svg,
    })
    .unwrap();
    tree.apply(&Mutation::CreateElement {
        id: ElementId(3),
        element_type: ElementType::Div,
    })
    .unwrap();

    // setSrc: img-only, stores and replaces.
    tree.apply(&Mutation::SetSrc {
        id: ElementId(1),
        src: "/tmp/pic.png".into(),
    })
    .unwrap();
    assert_eq!(
        tree.get(ElementId(1)).unwrap().src.as_deref(),
        Some("/tmp/pic.png")
    );
    // Empty src rejects (mirrors the TS decoder; clearing an img source is
    // not a thing — destroy the element instead).
    let err = tree
        .apply(&Mutation::SetSrc {
            id: ElementId(1),
            src: String::new(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("non-empty"), "{err}");
    let err = tree
        .apply(&Mutation::SetSrc {
            id: ElementId(3),
            src: "x".into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("not an img"), "{err}");

    // setText carries svg markup (source), rejected on img.
    tree.apply(&Mutation::SetText {
        id: ElementId(2),
        text: "<svg xmlns='http://www.w3.org/2000/svg'/>".into(),
    })
    .unwrap();
    let err = tree
        .apply(&Mutation::SetText {
            id: ElementId(1),
            text: "nope".into(),
        })
        .unwrap_err();
    assert!(err.to_string().contains("not a text"), "{err}");

    // deferred + anchored store/clear universally.
    tree.apply(&Mutation::SetDeferred {
        id: ElementId(3),
        deferred: true,
    })
    .unwrap();
    assert!(tree.get(ElementId(3)).unwrap().deferred);
    tree.apply(&Mutation::SetAnchored {
        id: ElementId(3),
        anchor: Some(solid_gpui_protocol::AnchorKind::BottomRight),
    })
    .unwrap();
    assert_eq!(
        tree.get(ElementId(3)).unwrap().anchored,
        Some(solid_gpui_protocol::AnchorKind::BottomRight)
    );
    tree.apply(&Mutation::SetAnchored {
        id: ElementId(3),
        anchor: None,
    })
    .unwrap();
    assert_eq!(tree.get(ElementId(3)).unwrap().anchored, None);

    // svg/img reject children like canvas/markdown.
    let err = tree
        .apply(&Mutation::AppendChild {
            parent_id: ElementId(2),
            child_id: ElementId(3),
        })
        .unwrap_err();
    assert!(err.to_string().contains("no child slots"), "{err}");
}
