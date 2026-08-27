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

import { createSignal } from "solid-js"
import {
  encodeBatch,
  MUTATION_OPS,
  type MutationBatch,
  type MutationOp,
} from "@solid-gpui/protocol"
import { createSolidRenderer, type HostNode, type Send, type SolidGpuiRenderer } from "../packages/solid/src/renderer"
import { makeH } from "../packages/solid/src/h"

const ROWS = 200
const INDEPENDENT_SIGNALS = 100
const WARMUP_ITERATIONS = 20
const MEASURE_ITERATIONS = 80
const SAMPLES = 5

type PackageMetadata = Record<string, unknown>

type Recording = {
  readonly batches: MutationBatch[]
  readonly send: Send
}

type ExpectedOperations = Partial<Record<MutationOp, number>>

type RunningScenario = {
  readonly name: string
  readonly rows: number
  readonly expectedOperations: ExpectedOperations
  readonly recording: Recording
  readonly flush: () => Promise<void>
  readonly update: (step: number) => void
  readonly dispose: () => void
}

type Distribution = {
  readonly count: number
  readonly min: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
  readonly mean: number
}

type ScenarioReport = {
  readonly name: string
  readonly rows: number
  readonly expectedOperations: ExpectedOperations
  readonly mount: {
    readonly batches: number
    readonly mutations: Distribution
    readonly utf8Bytes: Distribution
    readonly operations: Partial<Record<MutationOp, number>>
  }
  readonly updates: {
    readonly count: number
    readonly latencyMs: Distribution
    readonly batchMutations: Distribution
    readonly batchUtf8Bytes: Distribution
    readonly operations: Partial<Record<MutationOp, number>>
  }
}

function recording(): Recording {
  const batches: MutationBatch[] = []
  const send: Send = async (batch) => {
    batches.push(batch)
    return { seq: batch.seq, applied: batch.mutations.length }
  }
  return { batches, send }
}

function textTree(
  R: SolidGpuiRenderer["renderer"],
  rows: number,
  textAt: (row: number) => () => string,
): HostNode {
  const root = R.createElement("div")
  R.setProp(root, "style", { display: "flex", flexDirection: "column", gap: 2 })
  for (let row = 0; row < rows; row += 1) {
    const item = R.createElement("div")
    R.insert(item, textAt(row))
    R.insertNode(root, item)
  }
  return root
}

async function singleTextScenario(): Promise<RunningScenario> {
  const rec = recording()
  const { renderer: R, render, flush } = createSolidRenderer(rec.send)
  const container = R.createElement("#root")
  const [tick, setTick] = createSignal(0)
  const dispose = render(
    () =>
      textTree(R, ROWS, (row) =>
        row === 0 ? () => `Row ${row}: ${tick()}` : () => `Row ${row}`,
      ),
    container,
  )
  await flush()
  return {
    name: "single-dependent-text",
    rows: ROWS,
    expectedOperations: { setText: 1 },
    recording: rec,
    flush,
    update: (step) => setTick(step + 1),
    dispose,
  }
}

async function fanoutTextScenario(): Promise<RunningScenario> {
  const rec = recording()
  const { renderer: R, render, flush } = createSolidRenderer(rec.send)
  const container = R.createElement("#root")
  const [tick, setTick] = createSignal(0)
  const dispose = render(
    () => textTree(R, ROWS, (row) => () => `Row ${row}: ${tick()}`),
    container,
  )
  await flush()
  return {
    name: "fanout-text",
    rows: ROWS,
    expectedOperations: { setText: ROWS },
    recording: rec,
    flush,
    update: (step) => setTick(step + 1),
    dispose,
  }
}

async function independentSignalsScenario(): Promise<RunningScenario> {
  const rec = recording()
  const { renderer: R, render, flush } = createSolidRenderer(rec.send)
  const container = R.createElement("#root")
  const setters: Array<(value: number) => void> = []
  const dispose = render(() => {
    const root = R.createElement("div")
    R.setProp(root, "style", { display: "flex", flexDirection: "column", gap: 2 })
    for (let row = 0; row < INDEPENDENT_SIGNALS; row += 1) {
      const [value, setValue] = createSignal(0)
      setters.push(setValue)
      const item = R.createElement("div")
      R.insert(item, () => `Row ${row}: ${value()}`)
      R.insertNode(root, item)
    }
    return root
  }, container)
  await flush()
  if (setters.length !== INDEPENDENT_SIGNALS) {
    throw new Error(`independent-signals: expected ${INDEPENDENT_SIGNALS} setters, got ${setters.length}`)
  }
  return {
    name: "independent-signals-one-flush",
    rows: INDEPENDENT_SIGNALS,
    expectedOperations: { setText: INDEPENDENT_SIGNALS },
    recording: rec,
    flush,
    update: (step) => {
      for (const setValue of setters) setValue(step + 1)
    },
    dispose,
  }
}

async function singleStyleScenario(): Promise<RunningScenario> {
  const rec = recording()
  const { renderer: R, render, flush } = createSolidRenderer(rec.send)
  const h = makeH(R)
  const container = R.createElement("#root")
  const [tick, setTick] = createSignal(0)
  const dispose = render(() => {
    const rows: HostNode[] = []
    for (let row = 0; row < ROWS; row += 1) {
      rows.push(
        h(
          "div",
          row === 0
            ? { style: () => ({ opacity: tick() % 2 === 0 ? 1 : 0.5 }) }
            : { style: { opacity: 1 } },
          `Row ${row}`,
        ),
      )
    }
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 2 } }, ...rows)
  }, container)
  await flush()
  return {
    name: "single-dependent-style",
    rows: ROWS,
    expectedOperations: { setStyle: 1 },
    recording: rec,
    flush,
    update: (step) => setTick(step + 1),
    dispose,
  }
}

const SCENARIOS: readonly (() => Promise<RunningScenario>)[] = [
  singleTextScenario,
  fanoutTextScenario,
  independentSignalsScenario,
  singleStyleScenario,
]

function rounded(value: number): number {
  return Number(value.toFixed(3))
}

function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) throw new Error("cannot summarize an empty distribution")
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (fraction: number): number => {
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
    return sorted[index] ?? 0
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    count: values.length,
    min: rounded(sorted[0] ?? 0),
    p50: rounded(percentile(0.5)),
    p95: rounded(percentile(0.95)),
    p99: rounded(percentile(0.99)),
    max: rounded(sorted[sorted.length - 1] ?? 0),
    mean: rounded(total / values.length),
  }
}

function countOperations(batches: readonly MutationBatch[]): Partial<Record<MutationOp, number>> {
  const counts: Partial<Record<MutationOp, number>> = {}
  for (const batch of batches) {
    for (const mutation of batch.mutations) {
      counts[mutation.op] = (counts[mutation.op] ?? 0) + 1
    }
  }
  return counts
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function batchSizes(batches: readonly MutationBatch[]): readonly number[] {
  return batches.map((batch) => batch.mutations.length)
}

function batchBytes(batches: readonly MutationBatch[]): readonly number[] {
  return batches.map((batch) => utf8Bytes(encodeBatch(batch)))
}

function assertExpectedOperations(
  batch: MutationBatch,
  expected: ExpectedOperations,
  scenario: string,
): void {
  const actual = countOperations([batch])
  for (const operation of MUTATION_OPS) {
    const want = expected[operation] ?? 0
    const got = actual[operation] ?? 0
    if (want !== got) {
      throw new Error(`${scenario}: expected ${want} ${operation} mutations, got ${got}`)
    }
  }
}

function summarizeMount(batches: readonly MutationBatch[]): ScenarioReport["mount"] {
  return {
    batches: batches.length,
    mutations: distribution(batchSizes(batches)),
    utf8Bytes: distribution(batchBytes(batches)),
    operations: countOperations(batches),
  }
}

async function runScenario(factory: () => Promise<RunningScenario>): Promise<ScenarioReport> {
  const scenario = await factory()
  const mountBatches = [...scenario.recording.batches]
  if (mountBatches.length === 0) throw new Error(`${scenario.name}: mount emitted no batch`)
  scenario.recording.batches.length = 0

  for (let i = 0; i < WARMUP_ITERATIONS; i += 1) {
    scenario.update(i)
    await scenario.flush()
    if (scenario.recording.batches.length !== 1) {
      throw new Error(`${scenario.name}: warmup update emitted ${scenario.recording.batches.length} batches`)
    }
    assertExpectedOperations(scenario.recording.batches[0]!, scenario.expectedOperations, scenario.name)
    scenario.recording.batches.length = 0
  }

  const latencies: number[] = []
  const updates: MutationBatch[] = []
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    for (let iteration = 0; iteration < MEASURE_ITERATIONS; iteration += 1) {
      const step = WARMUP_ITERATIONS + sample * MEASURE_ITERATIONS + iteration
      const started = performance.now()
      scenario.update(step)
      await scenario.flush()
      latencies.push(performance.now() - started)
      if (scenario.recording.batches.length !== 1) {
        throw new Error(`${scenario.name}: measured update emitted ${scenario.recording.batches.length} batches`)
      }
      const batch = scenario.recording.batches[0]
      if (batch === undefined) throw new Error(`${scenario.name}: measured update emitted no batch`)
      assertExpectedOperations(batch, scenario.expectedOperations, scenario.name)
      updates.push(batch)
      scenario.recording.batches.length = 0
    }
  }

  scenario.dispose()
  await scenario.flush()

  return {
    name: scenario.name,
    rows: scenario.rows,
    expectedOperations: scenario.expectedOperations,
    mount: summarizeMount(mountBatches),
    updates: {
      count: updates.length,
      latencyMs: distribution(latencies),
      batchMutations: distribution(batchSizes(updates)),
      batchUtf8Bytes: distribution(batchBytes(updates)),
      operations: countOperations(updates),
    },
  }
}

async function packageVersion(path: string): Promise<string> {
  try {
    const raw: unknown = await Bun.file(new URL(`../node_modules/${path}/package.json`, import.meta.url)).json()
    if (typeof raw !== "object" || raw === null) return "unavailable"
    const version = (raw as PackageMetadata).version
    return typeof version === "string" ? version : "unavailable"
  } catch {
    return "unavailable"
  }
}

const reports: ScenarioReport[] = []
for (const scenario of SCENARIOS) reports.push(await runScenario(scenario))

const report = {
  schema: "solid-gpui-solid-benchmark/v1",
  mode: "headless-recording-send",
  runtime: {
    bun: Bun.version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    conditions: ["browser"],
  },
  packages: {
    solid: await packageVersion("solid-js"),
    universal: await packageVersion("@solidjs/universal"),
    web: await packageVersion("@solidjs/web"),
    compiler: await packageVersion("@solidjs/babel-plugin"),
  },
  compiler: {
    exercised: false,
    note: "This baseline uses runtime h()/renderer calls; compare compiled JSX with benchmark:compiler.",
  },
  config: {
    rows: ROWS,
    independentSignals: INDEPENDENT_SIGNALS,
    warmupIterations: WARMUP_ITERATIONS,
    measureIterations: MEASURE_ITERATIONS,
    samples: SAMPLES,
    measuredUpdatesPerScenario: MEASURE_ITERATIONS * SAMPLES,
  },
  scenarios: reports,
}

console.log(JSON.stringify(report, null, 2))
