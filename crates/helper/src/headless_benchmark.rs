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

//! Measurement-only headless GPUI benchmark.
//!
//! This module is test-only and is intentionally driven through the same
//! retained tree and `HostView::render` path as the helper. It does not alter
//! production rendering or add a performance threshold to CI.

use super::*;
use std::collections::BTreeMap;
use std::process::Command;
use std::time::{Duration, Instant};

const WARMUP_FRAMES: usize = 10;
const MEASURED_FRAMES: usize = 50;
const SMALL_ROWS: usize = 1;
const FANOUT_ROWS: usize = 200;
const ROOT_ID: ElementId = ElementId(1);

fn number(value: u64) -> StyleValue {
    StyleValue::Number(serde_json::Number::from(value))
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
        ("gap".to_string(), number(1)),
        ("backgroundColor".to_string(), text("#1e1e2e")),
    ])
}

fn row_style(row: usize) -> StyleMap {
    let background = if row.is_multiple_of(2) {
        "#313244"
    } else {
        "#45475a"
    };
    BTreeMap::from([
        ("height".to_string(), number(22)),
        ("padding".to_string(), number(2)),
        ("backgroundColor".to_string(), text(background)),
    ])
}

fn row_id(row: usize) -> ElementId {
    ElementId(2 + (row as u32 * 2))
}

fn text_id(row: usize) -> ElementId {
    ElementId(3 + (row as u32 * 2))
}

fn mount_mutations(rows: usize) -> Vec<Mutation> {
    let mut mutations = Vec::with_capacity(3 + rows * 6);
    mutations.push(Mutation::CreateElement {
        id: ROOT_ID,
        element_type: ElementType::Div,
    });
    mutations.push(Mutation::SetStyle {
        id: ROOT_ID,
        style: root_style(),
        state: None,
    });
    mutations.push(Mutation::SetRoot { id: ROOT_ID });
    for row in 0..rows {
        let row_id = row_id(row);
        let text_id = text_id(row);
        mutations.push(Mutation::CreateElement {
            id: row_id,
            element_type: ElementType::Div,
        });
        mutations.push(Mutation::CreateElement {
            id: text_id,
            element_type: ElementType::Text,
        });
        mutations.push(Mutation::SetStyle {
            id: row_id,
            style: row_style(row),
            state: None,
        });
        mutations.push(Mutation::SetText {
            id: text_id,
            text: format!("Row {row}: initial"),
        });
        mutations.push(Mutation::AppendChild {
            parent_id: row_id,
            child_id: text_id,
        });
        mutations.push(Mutation::AppendChild {
            parent_id: ROOT_ID,
            child_id: row_id,
        });
    }
    mutations
}

fn update_mutations(rows: usize, step: usize) -> Vec<Mutation> {
    (0..rows)
        .map(|row| Mutation::SetText {
            id: text_id(row),
            text: format!("Row {row}: frame {step:04}"),
        })
        .collect()
}

fn apply_timed(window: &mut gpui::TestAppWindow<HostView>, mutations: &[Mutation]) -> Duration {
    window.update(|view, _, _| {
        let started = Instant::now();
        for mutation in mutations {
            if let Err(error) = view.tree.apply(mutation) {
                panic!("benchmark mutation must apply: {error:?}");
            }
        }
        started.elapsed()
    })
}

fn draw_timed(window: &mut gpui::TestAppWindow<HostView>) -> (Duration, u64, Duration) {
    let before = window.read(|view, _| view.stats.frames());
    let started = Instant::now();
    window.draw();
    let elapsed = started.elapsed();
    let (after, build) = window.read(|view, _| (view.stats.frames(), view.stats.last()));
    assert!(
        after > before,
        "headless draw must render HostView: frames {before} -> {after}"
    );
    let build = build.expect("headless draw must record a HostView build sample");
    (elapsed, after - before, build)
}

fn rounded_ms(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1_000.0 * 1_000.0).round() / 1_000.0
}

fn distribution(values: &[Duration]) -> serde_json::Value {
    assert!(!values.is_empty(), "benchmark distribution cannot be empty");
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

fn locked_gpui_source() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Cargo.lock");
    let Ok(lockfile) = std::fs::read_to_string(path) else {
        return "unavailable".to_string();
    };
    let mut in_gpui = false;
    for line in lockfile.lines() {
        if line == "[[package]]" {
            in_gpui = false;
        } else if line == "name = \"gpui\"" {
            in_gpui = true;
        } else if in_gpui && line.starts_with("source = ") {
            return line
                .trim_start_matches(r#"source = ""#)
                .trim_end_matches('"')
                .to_string();
        }
    }
    "unavailable".to_string()
}

fn run_scenario(name: &str, rows: usize) -> serde_json::Value {
    let mut app = gpui::TestApp::new();
    let mut window = app.open_window(|_, _| HostView::new());

    let mount = mount_mutations(rows);
    let mount_apply = apply_timed(&mut window, &mount);
    let (mount_draw, mount_frames, mount_build) = draw_timed(&mut window);

    for step in 0..WARMUP_FRAMES {
        let mutations = update_mutations(rows, step);
        let _ = apply_timed(&mut window, &mutations);
        let _ = draw_timed(&mut window);
    }

    let mut apply_samples = Vec::with_capacity(MEASURED_FRAMES);
    let mut draw_samples = Vec::with_capacity(MEASURED_FRAMES);
    let mut build_samples = Vec::with_capacity(MEASURED_FRAMES);
    let mut rendered_frames = 0;
    for step in WARMUP_FRAMES..(WARMUP_FRAMES + MEASURED_FRAMES) {
        let mutations = update_mutations(rows, step);
        apply_samples.push(apply_timed(&mut window, &mutations));
        let (draw, frames, build) = draw_timed(&mut window);
        draw_samples.push(draw);
        build_samples.push(build);
        rendered_frames += frames;
    }

    let frame_stats = window.read(|view, _| view.stats_value());
    let final_frames = window.read(|view, _| view.stats.frames());
    assert_eq!(
        rendered_frames, MEASURED_FRAMES as u64,
        "each measured draw should render exactly one frame"
    );

    let report = serde_json::json!({
        "name": name,
        "rows": rows,
        "retainedNodes": 1 + rows * 2,
        "mount": {
            "mutations": mount.len(),
            "applyMs": distribution(&[mount_apply]),
            "drawMs": distribution(&[mount_draw]),
            "hostBuildMs": distribution(&[mount_build]),
            "renderedFrames": mount_frames,
        },
        "updates": {
            "count": MEASURED_FRAMES,
            "mutationsPerUpdate": rows,
            "applyMs": distribution(&apply_samples),
            "drawMs": distribution(&draw_samples),
            "hostBuildMs": distribution(&build_samples),
            "renderedFrames": rendered_frames,
        },
        "frameStats": frame_stats,
        "finalFrameCount": final_frames,
    });

    drop(window);
    app.update(|cx| cx.shutdown());
    report
}

#[test]
#[ignore = "measurement benchmark; run the benchmark:gpui command"]
fn headless_render_benchmark() {
    let report = serde_json::json!({
        "schema": "solid-gpui-gpui-benchmark/v1",
        "mode": "headless-test-app",
        "runtime": {
            "rustc": command_version("rustc"),
            "targetOs": std::env::consts::OS,
            "targetArch": std::env::consts::ARCH,
            "helperPackage": env!("CARGO_PKG_VERSION"),
            "gpuiSource": locked_gpui_source(),
            "textSystem": "gpui::TestApp default test text system",
        },
        "config": {
            "warmupFrames": WARMUP_FRAMES,
            "measuredFrames": MEASURED_FRAMES,
            "workloads": ["small-tree", "fanout-200"],
        },
        "scenarios": [
            run_scenario("small-tree", SMALL_ROWS),
            run_scenario("fanout-200", FANOUT_ROWS),
        ],
        "boundaries": {
            "applyMs": "RetainedTree::apply for the generated mutation set; excludes JSON decode and IPC",
            "drawMs": "TestAppWindow::draw, including HostView render and GPUI layout/prepaint/paint; no presentation",
            "hostBuildMs": "HostView::FrameStats sample from the production retained-tree walk",
            "excluded": "display server, native window startup, GPU presentation, Solid scheduling, and client/helper IPC",
        },
    });
    println!(
        "HEADLESS_GPUI_BENCHMARK {}",
        serde_json::to_string(&report).expect("benchmark report serializes")
    );
}
