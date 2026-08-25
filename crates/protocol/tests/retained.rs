//! RetainedTree semantics: the shared fixture applies completely, the final
//! shape matches the mutation sequence, and invalid sequences fail with
//! precise errors. Pure data — no gpui, no IO.

use solid_gpui_protocol::{
    ApplyError, ElementType, EventType, Mutation, RetainedTree, StyleMap, StyleValue, from_json,
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
    let err = tree
        .apply(&set_animation(
            StyleMap::from([("padding".to_string(), StyleValue::Number(8u32.into()))]),
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
