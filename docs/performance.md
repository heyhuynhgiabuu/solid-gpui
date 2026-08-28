# Performance measurements (Gate 6)

Measurement-led, not optimization-led: this report establishes the baseline
against the representative consumer fixture and the seven boundaries. No
optimizations are claimed. CI performance thresholds are deliberately absent
until scenarios stabilize across supported runners (ROADMAP Gate 6).

## Environment

| Field | Value |
| --- | --- |
| Date | 2026-08-28 |
| OS / arch | macOS (darwin) / arm64 |
| Bun | 1.4.0 |
| Node | v26.3.0 |
| Helper | 0.1.0 (debug build, `cargo build`) |
| Protocol | v1 |
| gpui | zed `35aab21` (pinned) |
| Mode | headless (transport benchmarks) + gpui TestApp (no real window server) |

Reproduce with: `bun run benchmark:consumer`, `benchmark:solid`,
`benchmark:stdio`, `benchmark:gpui`, `benchmark:lifecycle`,
`benchmark:protocol`, `benchmark:compiler` (each prints one JSON report).

## Representative consumer fixture (Gate 0 screen, real helper, transport)

Signal → `flush()` → client encode/write → helper decode/apply/ack →
correlation. n = 100 per interaction after 10 warmups.
`bun run benchmark:consumer`.

| Interaction | p50 | p95 | p99 |
| --- | --- | --- | --- |
| action-increment (1 setText) | 0.049 ms | 0.128 ms | 0.229 ms |
| input-edit (1 setValue + open) | 0.060 ms | 0.088 ms | 0.131 ms |
| option-select (deterministic alternation) | 0.165 ms | 0.212 ms | 0.277 ms |

Every measured flush carries real mutations: option-select alternates two
distinct colors deterministically (a random choice sometimes equaled the
current value and silently measured no-op flushes instead).

Excluded: GPUI layout/paint (no window in transport mode).

## Wire serialization + transport (batch-01, 12 mutations)

`bun run benchmark:stdio`. Encode/decode per operation: p50 ≈ 0.002 ms /
0.003 ms. Real-pipe round trip (client write → helper decode/apply/ack →
correlation), n = 50: p50 0.145 ms, p95 0.278 ms, p99 0.337 ms. Sequence
correlation verified; acknowledged mutations equal expected.

## Solid scheduling + mutation creation (200-row synthetic shapes)

`bun run benchmark:solid`. Update-path latency (n = 400 per scenario,
recording send — transport excluded):

| Scenario | mutations/update | p50 | p95 | p99 |
| --- | --- | --- | --- | --- |
| fanout-text (200 setText) | 200 | 0.053 ms | 0.124 ms | 0.743 ms |
| single-dependent-text | 1 | similar magnitude | | |

The renderer's redundant-write skipping holds: a single dependent signal
emits exactly 1 setText across 200 rows.

## Retained-tree apply + GPUI frame (helper-side, TestApp)

`bun run benchmark:gpui` (headless TestApp — NOT real window-server paint):
1-mutation update apply p50 ≈ 0.001 ms; draw p50 ≈ 0.107 ms, p99 ≈ 0.172 ms
(small tree); helper-reported frame build p95 ≈ 0.025 ms.

## Lifecycle retention (20 mount/update/destroy cycles, unique ids)

`bun run benchmark:lifecycle`. Mount apply p50 ≈ 0.177 ms, mount draw p50 ≈
1.257 ms; retention checks: every destroyed cycle's unique ids absent and
root cleared (20/20); per-id state maps reported honestly (non-pruned state
is visible, not hidden). Resident set stabilizes after early cycles.

## Protocol wire-format candidate (P12 probe)

`bun run benchmark:protocol`: the numeric-op candidate reduces wire bytes
past the 20% bar but regresses encode by ~32% (over the 10% gate) —
recommendation: **keep the object JSON format** (Gate 7 stays closed).

## Compiled JSX vs runtime h()

`bun run benchmark:compiler`: compiled-JSX and runtime-h() creation/update
paths are measured head-to-head at 200 rows; differences are within noise
on this machine (same mutation stream, same renderer).

## Reading this report

- Headless numbers exclude window-server behavior; GUI verification stays a
  separate Gate 3 exit item.
- A candidate optimization must improve a NAMED metric here without
  increasing mutation errors, duplicate removals, stale events, poisoned
  batches, lifecycle retention, or frame instability.
