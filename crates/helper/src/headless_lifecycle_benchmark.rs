/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

//! Measurement-only lifecycle and retention benchmark.
//!
//! The benchmark uses unique element ids for each mount so stale host-side
//! state cannot hide behind an overwritten map entry. It reports retained-tree
//! clearing and host-state observations separately; it does not change the
//! cleanup policy or impose a memory threshold.

use super::*;
use std::collections::BTreeMap;
use std::process::Command;
use std::time::{Duration, Instant};

const CYCLES: usize = 20;
const LIST_ROWS: usize = 24;
const ID_STRIDE: u32 = 1_000;
const ROOT_OFFSET: u32 = 0;
const SCROLL_OFFSET: u32 = 1;
const SCROLL_CONTENT_OFFSET: u32 = 2;
const SCROLL_TEXT_OFFSET: u32 = 3;
const INPUT_OFFSET: u32 = 4;
const LIST_OFFSET: u32 = 5;
const MARKDOWN_OFFSET: u32 = 6;
const ANIMATED_OFFSET: u32 = 7;
const LIST_ITEMS_OFFSET: u32 = 8;

struct LifecycleFixture {
    root: ElementId,
    ids: Vec<ElementId>,
    mount: Vec<Mutation>,
    update: Mutation,
    destroy: Mutation,
}

fn number(value: u64) -> StyleValue {
    StyleValue::Number(serde_json::Number::from(value))
}

fn decimal(value: f64) -> StyleValue {
    StyleValue::Number(
        serde_json::Number::from_f64(value).expect("benchmark decimal must be finite"),
    )
}

fn text(value: &str) -> StyleValue {
    StyleValue::Text(value.to_string())
}

fn root_style() -> StyleMap {
    BTreeMap::from([
        ("display".to_string(), text("flex")),
        ("flexDirection".to_string(), text("column")),
        ("width".to_string(), number(480)),
        ("height".to_string(), number(360)),
        ("gap".to_string(), number(2)),
        ("backgroundColor".to_string(), text("#1e1e2e")),
    ])
}

fn scroll_style() -> StyleMap {
    BTreeMap::from([
        ("display".to_string(), text("flex")),
        ("flexDirection".to_string(), text("column")),
        ("width".to_string(), number(480)),
        ("height".to_string(), number(80)),
        ("overflow".to_string(), text("scroll")),
        ("backgroundColor".to_string(), text("#313244")),
    ])
}

fn input_style() -> StyleMap {
    BTreeMap::from([
        ("width".to_string(), number(480)),
        ("height".to_string(), number(28)),
        ("padding".to_string(), number(2)),
        ("tabIndex".to_string(), number(0)),
        ("placeholder".to_string(), text("lifecycle input")),
    ])
}

fn list_style() -> StyleMap {
    BTreeMap::from([
        ("display".to_string(), text("flex")),
        ("flexDirection".to_string(), text("column")),
        ("width".to_string(), number(480)),
        ("height".to_string(), number(140)),
        ("itemHeight".to_string(), number(22)),
    ])
}

fn row_style(row: usize) -> StyleMap {
    let background = if row.is_multiple_of(2) {
        "#45475a"
    } else {
        "#585b70"
    };
    BTreeMap::from([
        ("height".to_string(), number(22)),
        ("padding".to_string(), number(2)),
        ("backgroundColor".to_string(), text(background)),
    ])
}

fn id(base: u32, offset: u32) -> ElementId {
    ElementId(base + offset)
}

fn fixture(cycle: usize) -> LifecycleFixture {
    let base = 1 + cycle as u32 * ID_STRIDE;
    let root = id(base, ROOT_OFFSET);
    let scroll = id(base, SCROLL_OFFSET);
    let scroll_content = id(base, SCROLL_CONTENT_OFFSET);
    let scroll_text = id(base, SCROLL_TEXT_OFFSET);
    let input = id(base, INPUT_OFFSET);
    let list = id(base, LIST_OFFSET);
    let markdown = id(base, MARKDOWN_OFFSET);
    let animated = id(base, ANIMATED_OFFSET);

    let mut ids = vec![
        root,
        scroll,
        scroll_content,
        scroll_text,
        input,
        list,
        markdown,
        animated,
    ];
    let mut mount = Vec::with_capacity(20 + LIST_ROWS * 6);
    for (element_id, element_type) in [
        (root, ElementType::Div),
        (scroll, ElementType::Div),
        (scroll_content, ElementType::Div),
        (scroll_text, ElementType::Text),
        (input, ElementType::Input),
        (list, ElementType::List),
        (markdown, ElementType::Markdown),
        (animated, ElementType::Div),
    ] {
        mount.push(Mutation::CreateElement {
            id: element_id,
            element_type,
        });
    }
    mount.extend([
        Mutation::SetStyle {
            id: root,
            style: root_style(),
            state: None,
        },
        Mutation::SetStyle {
            id: scroll,
            style: scroll_style(),
            state: None,
        },
        Mutation::SetStyle {
            id: scroll_content,
            style: BTreeMap::from([("height".to_string(), number(800))]),
            state: None,
        },
        Mutation::SetStyle {
            id: input,
            style: input_style(),
            state: None,
        },
        Mutation::SetValue {
            id: input,
            value: format!("cycle {cycle}"),
        },
        Mutation::SetEventListener {
            id: input,
            event_type: EventType::Focus,
            enabled: true,
        },
        Mutation::SetStyle {
            id: list,
            style: list_style(),
            state: None,
        },
        Mutation::SetText {
            id: scroll_text,
            text: format!("scroll content for cycle {cycle}"),
        },
        Mutation::SetText {
            id: markdown,
            text: format!("# Lifecycle cycle {cycle}\n\nretention probe"),
        },
        Mutation::SetStyle {
            id: animated,
            style: BTreeMap::from([
                ("height".to_string(), number(22)),
                ("opacity".to_string(), decimal(1.0)),
            ]),
            state: None,
        },
        Mutation::SetAnimation {
            id: animated,
            target: BTreeMap::from([("opacity".to_string(), decimal(0.5))]),
            transition_ms: 1_000,
            easing: Some("linear".to_string()),
        },
    ]);

    mount.push(Mutation::SetRoot { id: root });
    mount.push(Mutation::AppendChild {
        parent_id: scroll_content,
        child_id: scroll_text,
    });
    mount.push(Mutation::AppendChild {
        parent_id: scroll,
        child_id: scroll_content,
    });

    for row in 0..LIST_ROWS {
        let row_id = id(base, LIST_ITEMS_OFFSET + row as u32 * 2);
        let text_id = id(base, LIST_ITEMS_OFFSET + row as u32 * 2 + 1);
        ids.extend([row_id, text_id]);
        mount.push(Mutation::CreateElement {
            id: row_id,
            element_type: ElementType::Div,
        });
        mount.push(Mutation::CreateElement {
            id: text_id,
            element_type: ElementType::Text,
        });
        mount.push(Mutation::SetStyle {
            id: row_id,
            style: row_style(row),
            state: None,
        });
        mount.push(Mutation::SetText {
            id: text_id,
            text: format!("cycle {cycle}, list row {row}"),
        });
        mount.push(Mutation::AppendChild {
            parent_id: row_id,
            child_id: text_id,
        });
        mount.push(Mutation::AppendChild {
            parent_id: list,
            child_id: row_id,
        });
    }

    for child_id in [scroll, input, list, markdown, animated] {
        mount.push(Mutation::AppendChild {
            parent_id: root,
            child_id,
        });
    }

    LifecycleFixture {
        root,
        ids,
        mount,
        update: Mutation::SetText {
            id: markdown,
            text: format!("# Lifecycle cycle {cycle} updated\n\nretention probe"),
        },
        destroy: Mutation::DestroyElement { id: root },
    }
}

fn apply_one(view: &mut HostView, cx: &mut gpui::App, mutation: &Mutation) -> Result<(), String> {
    let pending_animation = view.prepare_animation(mutation);
    view.tree
        .apply(mutation)
        .map_err(|error| error.to_string())?;

    match mutation {
        Mutation::SetStyle { id, .. } => {
            view.ensure_scroll_handle(*id);
            view.ensure_focus_handle(*id, cx);
            view.ensure_list_state(*id);
        }
        Mutation::CreateElement {
            id,
            element_type: ElementType::List,
        } => view.ensure_list_state(*id),
        Mutation::SetEventListener { id, .. } => view.ensure_focus_handle(*id, cx),
        Mutation::SetValue { id, value } => view.set_input_value(*id, value),
        _ => {}
    }

    if let Some((id, animation)) = pending_animation {
        view.upsert_animation(id, animation);
    }
    if let Some(content_id) = match mutation {
        Mutation::SetText { id, .. }
        | Mutation::SetTextRuns { id, .. }
        | Mutation::SetStyle { id, .. }
        | Mutation::SetValue { id, .. } => Some(*id),
        _ => None,
    } {
        view.remeasure_content(content_id);
    }
    Ok(())
}

fn apply_timed(window: &mut gpui::TestAppWindow<HostView>, mutations: &[Mutation]) -> Duration {
    window.update(|view, _, cx| {
        let started = Instant::now();
        for mutation in mutations {
            if let Err(error) = apply_one(view, cx, mutation) {
                panic!("lifecycle benchmark mutation must apply: {error}");
            }
        }
        let elapsed = started.elapsed();
        cx.notify();
        elapsed
    })
}

fn seed_transient_state(
    window: &mut gpui::TestAppWindow<HostView>,
    bar_id: ElementId,
    target_id: ElementId,
) {
    window.update(|view, _, _| {
        view.key_pending.borrow_mut().insert(bar_id, (0, 0));
        view.mark_autofocus(bar_id);
        *view.scrollbar_drag.borrow_mut() = Some((
            bar_id,
            target_id,
            gpui::ScrollHandle::new(),
            px(0.),
            px(0.),
            px(0.),
        ));
    });
}

fn draw_timed(window: &mut gpui::TestAppWindow<HostView>) -> (Duration, u64) {
    let before = window.read(|view, _| view.stats.frames());
    let started = Instant::now();
    window.draw();
    let elapsed = started.elapsed();
    let after = window.read(|view, _| view.stats.frames());
    assert!(
        after > before,
        "lifecycle draw must render HostView: frames {before} -> {after}"
    );
    (elapsed, after - before)
}

fn state_snapshot(view: &HostView, ids: &[ElementId]) -> serde_json::Value {
    let retained_nodes = ids
        .iter()
        .filter(|id| view.tree.get(**id).is_some())
        .count();
    serde_json::json!({
        "retainedNodes": retained_nodes,
        "rootPresent": view.tree.root().is_some(),
        "scrollHandles": view.scroll_handles.borrow().len(),
        "focusHandles": view.focus_handles.borrow().len(),
        "inputStates": view.input_states.borrow().len(),
        "markdownCache": view.markdown_cache.borrow().len(),
        "focusSubscriptions": view.focus_subscriptions.len(),
        "focusSubscribed": view.focus_subscribed.len(),
        "listStates": view.list_states.len(),
        "listRenderCounts": view.list_render_counts.len(),
        "listAlignment": view.list_alignment.len(),
        "listFollowArmed": view.list_follow_armed.len(),
        "listChildren": view.list_children.len(),
        "animations": view.animations.len(),
        "keyPending": view.key_pending.borrow().len(),
        "autofocusPending": view.autofocus_pending.is_some(),
        "scrollbarDragActive": view.scrollbar_drag.borrow().is_some(),
    })
}

fn assert_no_host_state(snapshot: &serde_json::Value, cycle: usize) {
    for key in [
        "scrollHandles",
        "focusHandles",
        "inputStates",
        "markdownCache",
        "focusSubscriptions",
        "focusSubscribed",
        "listStates",
        "listRenderCounts",
        "listAlignment",
        "listFollowArmed",
        "listChildren",
        "animations",
        "keyPending",
    ] {
        let count = snapshot
            .get(key)
            .and_then(serde_json::Value::as_u64)
            .expect("host-state count");
        assert_eq!(count, 0, "destroy cycle {cycle} retained {key}={count}");
    }
    assert_eq!(
        snapshot.get("autofocusPending"),
        Some(&serde_json::Value::Bool(false)),
        "destroy cycle {cycle} retained an autofocus target"
    );
    assert_eq!(
        snapshot.get("scrollbarDragActive"),
        Some(&serde_json::Value::Bool(false)),
        "destroy cycle {cycle} retained a scrollbar drag"
    );
}

fn rounded_ms(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1_000.0 * 1_000.0).round() / 1_000.0
}

fn distribution(values: &[Duration]) -> serde_json::Value {
    assert!(!values.is_empty(), "lifecycle distribution cannot be empty");
    let mut sorted: Vec<f64> = values.iter().map(|value| rounded_ms(*value)).collect();
    sorted.sort_by(f64::total_cmp);
    let percentile = |fraction: f64| {
        let index = ((sorted.len() as f64 * fraction).ceil() as usize)
            .saturating_sub(1)
            .min(sorted.len() - 1);
        sorted[index]
    };
    let total: f64 = sorted.iter().sum();
    serde_json::json!({
        "count": sorted.len(),
        "minMs": sorted[0],
        "p50Ms": percentile(0.50),
        "p95Ms": percentile(0.95),
        "p99Ms": percentile(0.99),
        "maxMs": sorted[sorted.len() - 1],
        "meanMs": (total / sorted.len() as f64 * 1_000.0).round() / 1_000.0,
    })
}

#[cfg(target_os = "macos")]
fn resident_bytes() -> Option<u64> {
    let pid = std::process::id().to_string();
    let output = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid])
        .output()
        .ok()?;
    let kib = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u64>()
        .ok()?;
    kib.checked_mul(1024)
}

#[cfg(target_os = "linux")]
fn resident_bytes() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let kib = status
        .lines()
        .find_map(|line| line.strip_prefix("VmRSS:"))?
        .split_whitespace()
        .next()?
        .parse::<u64>()
        .ok()?;
    kib.checked_mul(1024)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn resident_bytes() -> Option<u64> {
    None
}

fn resident_source() -> &'static str {
    if cfg!(target_os = "macos") {
        "ps rss snapshot"
    } else if cfg!(target_os = "linux") {
        "/proc/self/status VmRSS snapshot"
    } else {
        "unavailable on this target"
    }
}

fn signed_delta(before: Option<u64>, after: Option<u64>) -> Option<i64> {
    let before = i128::from(before?);
    let after = i128::from(after?);
    i64::try_from(after - before).ok()
}

fn run_lifecycle_benchmark() -> serde_json::Value {
    let rss_before = resident_bytes();
    let mut rss_samples = vec![serde_json::json!({
        "point": "before",
        "bytes": rss_before,
    })];
    let mut mount_apply = Vec::with_capacity(CYCLES);
    let mut mount_draw = Vec::with_capacity(CYCLES);
    let mut update_apply = Vec::with_capacity(CYCLES);
    let mut update_draw = Vec::with_capacity(CYCLES);
    let mut destroy_apply = Vec::with_capacity(CYCLES);
    let mut destroy_draw = Vec::with_capacity(CYCLES);
    let mut first_before = None;
    let mut first_after = None;
    let mut final_after = None;
    let mut cleared_cycles = 0;
    let mut final_frames = 0;
    let mut seen_ids = Vec::with_capacity(CYCLES * fixture(0).ids.len());
    let mut app = gpui::TestApp::new();
    let mut window = app.open_window(|_, _| HostView::new());

    for cycle in 0..CYCLES {
        let fixture = fixture(cycle);
        seen_ids.extend(fixture.ids.iter().copied());
        mount_apply.push(apply_timed(&mut window, &fixture.mount));
        let (draw, _) = draw_timed(&mut window);
        mount_draw.push(draw);

        update_apply.push(apply_timed(
            &mut window,
            std::slice::from_ref(&fixture.update),
        ));
        let (draw, _) = draw_timed(&mut window);
        update_draw.push(draw);
        seed_transient_state(&mut window, fixture.root, fixture.root);

        let before_destroy = window.read(|view, _| state_snapshot(view, &fixture.ids));
        if first_before.is_none() {
            first_before = Some(before_destroy);
        }

        destroy_apply.push(apply_timed(
            &mut window,
            std::slice::from_ref(&fixture.destroy),
        ));
        let (draw, _) = draw_timed(&mut window);
        destroy_draw.push(draw);

        let after_destroy = window.read(|view, _| state_snapshot(view, &seen_ids));
        let retained_nodes = after_destroy
            .get("retainedNodes")
            .and_then(serde_json::Value::as_u64)
            .expect("retained node count") as usize;
        let root_present = after_destroy
            .get("rootPresent")
            .and_then(serde_json::Value::as_bool)
            .expect("root presence");
        assert_eq!(
            retained_nodes, 0,
            "destroy cycle {cycle} must clear every retained element"
        );
        assert!(!root_present, "destroy cycle {cycle} must clear the root");
        assert_no_host_state(&after_destroy, cycle);
        if retained_nodes == 0 && !root_present {
            cleared_cycles += 1;
        }
        if cycle == 0 {
            first_after = Some(after_destroy.clone());
        }
        final_after = Some(after_destroy);
        final_frames = window.read(|view, _| view.stats.frames());

        if cycle + 1 == CYCLES / 2 || cycle + 1 == CYCLES {
            let bytes = resident_bytes();
            rss_samples.push(serde_json::json!({
                "point": format!("after-cycle-{}", cycle + 1),
                "bytes": bytes,
            }));
        }
    }

    let frame_stats = window.read(|view, _| view.stats_value());
    let rss_after = resident_bytes();
    rss_samples.push(serde_json::json!({
        "point": "after-benchmark",
        "bytes": rss_after,
    }));
    let report = serde_json::json!({
        "schema": "solid-gpui-lifecycle-benchmark/v1",
        "mode": "headless-test-app",
        "runtime": {
            "rustc": command_version("rustc"),
            "targetOs": std::env::consts::OS,
            "targetArch": std::env::consts::ARCH,
            "helperPackage": env!("CARGO_PKG_VERSION"),
            "textSystem": "gpui::TestApp default test text system",
        },
        "config": {
            "cycles": CYCLES,
            "listRowsPerCycle": LIST_ROWS,
            "uniqueIdStride": ID_STRIDE,
        },
        "workload": {
            "name": "stateful-mount-update-destroy",
            "knownNodesPerCycle": fixture(0).ids.len(),
            "mountMutations": fixture(0).mount.len(),
            "updateMutations": 1,
            "destroyMutations": 1,
        },
        "timings": {
            "mountApplyMs": distribution(&mount_apply),
            "mountDrawMs": distribution(&mount_draw),
            "updateApplyMs": distribution(&update_apply),
            "updateDrawMs": distribution(&update_draw),
            "destroyApplyMs": distribution(&destroy_apply),
            "destroyDrawMs": distribution(&destroy_draw),
        },
        "retention": {
            "clearedCycles": cleared_cycles,
            "expectedCycles": CYCLES,
            "checkedUniqueIds": seen_ids.len(),
            "firstBeforeDestroy": first_before,
            "firstAfterDestroy": first_after,
            "finalAfterDestroy": final_after,
            "finalFrameCount": final_frames,
            "frameStats": frame_stats,
        },
        "residentSet": {
            "source": resident_source(),
            "beforeBytes": rss_before,
            "afterBytes": rss_after,
            "deltaAfterBenchmarkBytes": signed_delta(rss_before, rss_after),
            "samples": rss_samples,
        },
        "boundaries": {
            "mountUpdateDestroy": "production HostView tree side effects plus RetainedTree::apply, followed by explicit TestAppWindow::draw",
            "retainedTree": "known unique ids must be absent and root must be None after every destroy draw",
            "hostState": "live handle/cache/subscription map sizes are observations; non-pruned state is reported, not hidden",
            "residentSet": "best-effort process RSS snapshot, platform-dependent and not an allocator or CI threshold",
            "excluded": "display server, native window startup, GPU presentation, Solid scheduling, and client/helper IPC",
        },
    });

    drop(window);
    app.update(|cx| cx.shutdown());
    report
}

#[test]
fn destroyed_stateful_tree_releases_host_state() {
    let fixture = fixture(0);
    let mut app = gpui::TestApp::new();
    let mut window = app.open_window(|_, _| HostView::new());

    apply_timed(&mut window, &fixture.mount);
    draw_timed(&mut window);
    seed_transient_state(&mut window, fixture.root, fixture.root);
    apply_timed(&mut window, std::slice::from_ref(&fixture.destroy));
    draw_timed(&mut window);

    let after_destroy = window.read(|view, _| state_snapshot(view, &fixture.ids));
    assert_eq!(
        after_destroy
            .get("retainedNodes")
            .and_then(serde_json::Value::as_u64),
        Some(0)
    );
    assert_eq!(
        after_destroy
            .get("rootPresent")
            .and_then(serde_json::Value::as_bool),
        Some(false)
    );
    assert_no_host_state(&after_destroy, 0);

    drop(window);
    app.update(|cx| cx.shutdown());
}

#[test]
fn stale_scrollbar_target_releases_drag_even_if_bar_survives() {
    let bar_id = ElementId(1);
    let target_id = ElementId(2);
    let mut app = gpui::TestApp::new();
    let mut window = app.open_window(|_, _| HostView::new());
    window.update(|view, _, _| {
        view.tree
            .apply(&Mutation::CreateElement {
                id: bar_id,
                element_type: ElementType::Div,
            })
            .expect("bar creates");
        view.tree
            .apply(&Mutation::SetRoot { id: bar_id })
            .expect("bar becomes root");
        *view.scrollbar_drag.borrow_mut() = Some((
            bar_id,
            target_id,
            gpui::ScrollHandle::new(),
            px(0.),
            px(0.),
            px(0.),
        ));
    });
    draw_timed(&mut window);
    assert!(!window.read(|view, _| view.scrollbar_drag.borrow().is_some()));

    drop(window);
    app.update(|cx| cx.shutdown());
}

fn command_version(command: &str) -> String {
    let Ok(output) = Command::new(command).arg("--version").output() else {
        return "unavailable".to_string();
    };
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        "unavailable".to_string()
    } else {
        version
    }
}

#[test]
#[ignore = "measurement benchmark; run the benchmark:lifecycle command"]
fn headless_lifecycle_benchmark() {
    println!(
        "HEADLESS_LIFECYCLE_BENCHMARK {}",
        serde_json::to_string(&run_lifecycle_benchmark()).expect("lifecycle report serializes")
    );
}
