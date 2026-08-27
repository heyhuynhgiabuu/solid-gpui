# solid-gpui roadmap

This roadmap describes the order for performance work and Solid-version
compatibility. It is a prioritization document, not a promise that every item
will ship. Every optimization must preserve the protocol, retained-tree, and
poison-on-failure invariants documented in `AGENTS.md` and
`.pi/artifacts/DECISIONS.md`.

## Current baseline

- The supported runtime is Solid `2.0.0-rc.3`, with matching
  `@solidjs/universal`, `@solidjs/web`, and `@solidjs/babel-plugin` packages.
- The renderer is out-of-process: Solid emits one NDJSON mutation batch per
  flush, `@solid-gpui/client` supervises the helper, and Rust owns GPUI layout,
  input state, animation, and painting.
- S7–S12, P1–P11, S14b, and packaging are implemented. P12 positional/numeric
  compaction was measured and parked because the candidate encoder regressed;
  the object wire format remains the compatibility baseline.
- Hosted CI validates TypeScript, Node smoke, and protocol/helper headless plus
  stdio execution on Linux and Windows. macOS has the local full-suite/window
  evidence; GUI suites remain explicitly environment-gated in CI.

## Compatibility policy

| Runtime | Status | Plan |
| --- | --- | --- |
| Solid 2.0.0-rc.3 | Supported | Keep all Solid runtime, universal renderer, web, and compiler packages aligned; test every upgrade as one set. |
| Solid 1.x (latest 1.9 line) | Not supported by the current package | Time-box a separate adapter/package spike before making a support promise. Do not switch APIs based on runtime feature detection. |

Solid 1 and Solid 2 differ in more than package names. Solid 1 uses the
one-callback effect/batch model and the older universal/compiler boundaries;
Solid 2 uses microtask batching with `flush()`, split tracking/effect phases,
changed ownership rules, and async computations in the reactive graph. A
single renderer that silently accepts both would make scheduling and disposal
bugs difficult to diagnose.

## Optimization principles

1. **Measure the whole pipeline before changing it.** Separate Solid graph
   work, renderer/flush work, JSON encoding, child-process round trips, helper
   layout/paint, and memory/lifecycle costs. A smaller JSON line is not an
   improvement if it increases encoder or validation time.
2. **Keep the process boundary out of frame loops.** Animations and other
   time-sensitive work stay host-side; ordinary Solid updates should remain
   one mutation batch per flush.
3. **Optimize identity before bytes.** Stable keyed list identity, skipped
   unchanged properties, and correct subtree disposal are safer first targets
   than wire-format changes.
4. **Keep Solid-specific advice versioned.** Solid 1 guidance may use `batch`,
   `mapArray`, or `indexArray`; Solid 2 guidance must use its automatic
   microtask batching and `flush()` semantics instead. Never copy a scheduling
   recipe across the version boundary without a test.
5. **No compatibility weakening for a benchmark.** Any mutation coalescing,
   lifecycle shortcut, or protocol change needs cross-language fixtures,
   ordering tests, and real client/helper evidence.

## Work sequence

### 1. Measurement foundation — next

Build deterministic scenarios that can be run against both a Solid 1 adapter
(spike) and the supported Solid 2 renderer:

- signal update → mutation count and mutation categories;
- `flush()`/event-to-ack latency and batch size;
- JSON encode/decode time and UTF-8 byte count;
- client/helper round-trip latency;
- retained-tree apply, GPUI layout/paint, and frame statistics;
- mount/update/destroy memory and listener/subtree retention.

Report p50/p95/p99, sample size, runtime/compiler versions, OS, and whether the
measurement is headless or GUI-backed. Establish baselines before adding CI
performance thresholds; platform-specific thresholds must not be inferred
from macOS measurements.

The first headless Solid 2 baseline is available with:

```sh
bun run benchmark:solid
```

It emits schema `solid-gpui-solid-benchmark/v1` and asserts deterministic
mutation expectations for a single dependent text update, a 200-row fan-out,
100 independent signals committed by one flush, and a single dependent style
update. It reports update latency, mutation counts/categories, encoded UTF-8
batch sizes, and the pinned runtime/compiler metadata. The recording send is
intentional: this isolates Solid and renderer scheduling; JSON timing, real
child-process IPC, GPUI layout/paint, and memory measurements remain separate
follow-up dimensions.

The next headless boundary baseline is available with:

```sh
cargo build -p solid-gpui-helper
bun run benchmark:stdio
```

It uses the real `@solid-gpui/client` and helper in `--stdio` transport mode,
with sequential unique sequence numbers and acknowledgement checks for every
request. It reports local `encodeBatch`/`decodeBatch` distributions plus
end-to-end client-write → helper-decode/apply/ack → client-correlation
round-trip distributions. Transport mode deliberately excludes GPUI layout,
paint, and window startup; those remain a separate host benchmark.

The retained-tree and headless host baseline is available with:

```sh
bun run benchmark:gpui
```

This runs an ignored Rust measurement test through GPUI's in-memory
`TestAppWindow::draw()` seam. It reports exact retained-tree apply time,
whole headless draw time (render/layout/prepaint/paint without presentation),
production `HostView` build samples, and frame counts for a small tree and a
200-row fan-out. The default `TestApp` text system is not a real font/GPU or
window-server measurement; those dimensions remain separate and GUI tests stay
environment-gated.

The lifecycle and retention baseline is available with:

```sh
bun run benchmark:lifecycle
```

It runs 20 unique-id mount → update → destroy cycles through the headless
`TestAppWindow` seam. Every cycle confirms that the retained tree and root are
cleared, while timing distributions cover mount/update/destroy apply and draw
work. It also reports host-side handle/cache/subscription counts before and
after destruction plus best-effort process RSS snapshots. RSS is
platform-dependent and observational, not an allocator measurement or a CI
threshold. The initial run exposed growth in list-state and
focus-subscription maps across unique-id cycles; the lifecycle path now prunes
those host-side states and the benchmark asserts zero retained host state
after every cycle. The RSS result remains an observation rather than an
optimization claim or threshold.

The compiler comparison baseline is available with:

```sh
bun run benchmark:compiler
```

It transforms a 200-row Solid 2 JSX fixture with the pinned
`@solidjs/babel-plugin@2.0.0-rc.3` under the `browser` condition, then compares
compiled JSX with a runtime `h()` builder through the same renderer, signal,
flush, and recording-send boundary. It reports transform/output size,
helper imports, mount/update mutation shapes, cleanup counts, and p50/p95/p99
runtime timings. It intentionally excludes real IPC, helper/GPUI work, and
font/GPU presentation. The current fixture flags operation-shape differences:
compiled universal insertion emits more mount and per-update create/remove
work than `h()`; the benchmark records that result rather than assuming that
smaller generated JavaScript means a faster renderer path.

### 2. Solid 2 RC maintenance and optimization

- Keep the existing `flushSolid()`-then-microtask drain contract and test that
  one user update still emits one coherent batch.
- Compare compiled JSX with runtime `h()` paths. Prefer compiler output in
  application hot paths, while retaining `h()` for trusted dynamic APIs.
- Use `createMemo`/lazy derivations for expensive values only when a benchmark
  shows repeated computation; do not replace derived values with write-back
  effects.
- Profile mutation emission and helper layout before attempting coalescing.
  Candidate coalescing is limited to provably redundant writes within one
  batch; create/destroy, attach/detach, listener, and ordering semantics stay
  explicit.
- Track each RC upgrade as a lockstep migration of runtime, universal, web,
  compiler, tests, and browser-conditioned entry points.

### 3. Solid 1 compatibility spike — time-boxed

Implement and test a versioned boundary rather than branching on incidental
runtime properties:

- verify the Solid 1 universal renderer and compiler output against the same
  renderer contract;
- isolate effect, batching, ownership, and disposal differences in an
  adapter, with no Solid 1 imports in the Solid 2 entry point;
- run lifecycle, keyed reorder, input, event, and helper-pipe tests under the
  pinned Solid 1 version;
- decide whether the result deserves a separately named package/entry point,
  or should remain an explicitly unsupported experiment.

The spike is successful only if it produces a support matrix and a repeatable
cross-runtime test command. API compatibility without lifecycle and wire
parity is not sufficient.

### 4. Semantics-preserving renderer/host work

After the baselines and compatibility decision:

- remove measured redundant style/text/value mutations;
- improve list reconciliation and host-side virtualization without changing
  element identity or retained-tree ownership;
- profile GPUI layout, text shaping, image/cache, and paint costs separately;
- add regression budgets only for stable, reproducible scenarios.

Each candidate is accepted only when it improves the relevant p95 or memory
metric without increasing mutation errors, duplicate removals, stale events,
poisoned batches, or frame instability.

### 5. Wire-format optimization — optional

Revisit P12 only if the measurement foundation shows JSON encoding/transport
is a material bottleneck. Before implementation, write a direct encoder design
covering versioning, compatibility, error behavior, fixture generation, and
fallback/negotiation. Then compare it with the current object encoder at the
same workload. If the direct encoder does not win end-to-end, keep the object
format.

## Solid authoring guidance by version

### Solid 1 track

Use compiler-generated universal output, `createMemo` for cached derived
values, `batch` only around deliberately grouped synchronous writes, and
`mapArray`/`indexArray` according to whether identity or position is stable.
Measure these choices against the renderer; they are not substitutes for
renderer or helper profiling.

### Solid 2 track

Use the compiler/runtime versions as a lockstep set. Rely on automatic
microtask batching and call `flush()` only at an imperative boundary that
requires committed state immediately. Keep tracking work separate from side
effects, avoid writes under owned reactive scope, and use lazy/derived
primitives for genuinely demand-driven work. The current entry points must be
run with `--conditions=browser` so Solid does not resolve its non-reactive SSR
stubs.

## Deferred work and stop conditions

- P12 stays deferred until its direct encoder and compatibility design exist.
- Outside-click dismissal and IME-composition arrow suppression remain outside
  S14b’s contract.
- Do not add Linux/Windows GUI claims or platform packages based on a successful
  build alone; require hosted runtime evidence.
- Stop an optimization slice when its benchmark is noisy, its improvement is
  below the measurement error, or it requires weakening a protocol/lifecycle
  invariant. Record the result instead of accumulating speculative complexity.

## Research sources

- [Solid 2.0 RC announcement](https://github.com/solidjs/solid/releases/tag/v2.0.0-rc.0)
- [Solid 2 reactivity, batching, and effects RFC](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/01-reactivity-batching-effects.md)
- [Solid 2 signals, derived primitives, and ownership RFC](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/02-signals-derived-ownership.md)
- [Solid fine-grained reactivity](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity)
- [Solid `createMemo`](https://docs.solidjs.com/reference/basic-reactivity/create-memo)
- [Solid `batch`](https://docs.solidjs.com/reference/reactive-utilities/batch)
- [Solid `mapArray`](https://docs.solidjs.com/reference/reactive-utilities/map-array)
- [Solid `indexArray`](https://docs.solidjs.com/reference/reactive-utilities/index-array)

Version metadata was checked locally with `npm view` for
`solid-js@1.9.15` and `solid-js@2.0.0-rc.3` on 2026-08-27. The Solid 2 RC
research reflects the RC documentation and the repository’s pinned RC.3
packages; future RC changes must be re-verified before adoption.
