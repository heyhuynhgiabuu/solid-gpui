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

import { decodeBatch, encodeBatch, type MutationBatch } from "../packages/protocol/src/batch"
import {
  MUTATION_OPS,
  type Mutation,
  type MutationOp,
} from "../packages/protocol/src/mutation"

const FIXTURES = [
  "batch-01.json",
  "batch-animation-01.json",
  "batch-canvas-01.json",
  "batch-accessibility-01.json",
  "batch-drag-01.json",
  "batch-keys-01.json",
  "batch-list-01.json",
  "batch-markdown-01.json",
  "batch-media-01.json",
  "batch-scrollbar-01.json",
  "batch-style-state-01.json",
  "batch-text-runs-01.json",
  "batch-tooltip-01.json",
] as const

const WARMUP_ITERATIONS = 1_000
const MEASURE_ITERATIONS = 10_000
const SAMPLES = 5
const MIN_WIRE_REDUCTION_PERCENT = 20
const MAX_ENCODE_REGRESSION_PERCENT = 10

const OP_CODES: { readonly [K in MutationOp]: number } = {
  createElement: 0,
  destroyElement: 1,
  appendChild: 2,
  removeChild: 3,
  insertBefore: 4,
  setStyle: 5,
  setText: 6,
  setTextRuns: 7,
  setKeyBindings: 8,
  setSrc: 9,
  setDeferred: 10,
  setAnchored: 11,
  setDrawList: 12,
  setDragData: 13,
  setValue: 14,
  setTooltip: 15,
  setAccessibility: 16,
  setAnimation: 17,
  setEventListener: 18,
  setRoot: 19,
}

const OP_NAMES: readonly MutationOp[] = MUTATION_OPS

/** Field order in each positional row; optional fields are trailing. */
const OP_FIELDS: { readonly [K in MutationOp]: readonly string[] } = {
  createElement: ["id", "elementType"],
  destroyElement: ["id"],
  appendChild: ["parentId", "childId"],
  removeChild: ["parentId", "childId"],
  insertBefore: ["parentId", "childId", "beforeId"],
  setStyle: ["id", "style", "state"],
  setText: ["id", "text"],
  setTextRuns: ["id", "runs"],
  setKeyBindings: ["id", "bindings"],
  setSrc: ["id", "src"],
  setDeferred: ["id", "deferred"],
  setAnchored: ["id", "anchor"],
  setDrawList: ["id", "items"],
  setDragData: ["id", "data"],
  setValue: ["id", "value"],
  setTooltip: ["id", "tooltip"],
  setAccessibility: ["id", "accessibility"],
  setAnimation: ["id", "target", "transitionMs", "easing"],
  setEventListener: ["id", "eventType", "enabled"],
  setRoot: ["id"],
}

type PositionalRow = readonly unknown[]
type PositionalBatch = readonly [1, number, readonly PositionalRow[]]

type BenchmarkCase = {
  readonly name: string
  readonly batch: MutationBatch
  readonly objectWire: string
  readonly stringWire: string
  readonly numericWire: string
}

type Timing = {
  readonly medianNsPerOp: number
  readonly minNsPerOp: number
  readonly maxNsPerOp: number
  readonly checksum: number
}

type Variant = "object" | "string" | "numeric"
type Timings = {
  readonly encode: Record<Variant, Timing>
  readonly parse: Record<Variant, Timing>
  readonly decode: Record<Variant, Timing>
}

function rowFor(mutation: Mutation, numeric: boolean): PositionalRow {
  const record = mutation as unknown as Record<string, unknown>
  const fields = OP_FIELDS[mutation.op]
  const values: unknown[] = []
  for (const field of fields) {
    const value = record[field]
    if (value === undefined) break
    values.push(value)
  }
  return [numeric ? OP_CODES[mutation.op] : mutation.op, ...values]
}

function compactBatch(batch: MutationBatch, numeric: boolean): PositionalBatch {
  return [batch.v, batch.seq, batch.mutations.map((mutation) => rowFor(mutation, numeric))]
}

function encodeCompact(batch: MutationBatch, numeric: boolean): string {
  return JSON.stringify(compactBatch(batch, numeric))
}

function parsedShapeSize(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (typeof value === "object" && value !== null) return Object.keys(value).length
  return 0
}

function operationAt(row: PositionalRow, numeric: boolean, name: string): MutationOp {
  const tag = row[0]
  if (numeric) {
    if (typeof tag !== "number" || !Number.isInteger(tag) || tag < 0 || tag >= OP_NAMES.length) {
      throw new Error(`${name}: invalid numeric opcode`)
    }
    const operation = OP_NAMES[tag]
    if (operation === undefined) throw new Error(`${name}: unknown numeric opcode`)
    return operation
  }
  if (typeof tag !== "string" || !MUTATION_OPS.includes(tag as MutationOp)) {
    throw new Error(`${name}: invalid operation name`)
  }
  return tag as MutationOp
}

/**
 * Representation-only decoder for the benchmark candidate. It checks the
 * envelope and positional arity, then expands rows into the existing semantic
 * shape; it intentionally does not duplicate decodeBatch's full validator.
 */
function decodeCompact(json: string, numeric: boolean): MutationBatch {
  const raw: unknown = JSON.parse(json)
  if (!Array.isArray(raw) || raw.length !== 3 || raw[0] !== 1 || typeof raw[1] !== "number" || !Array.isArray(raw[2])) {
    throw new Error("compact envelope is invalid")
  }
  const mutations = raw[2].map((value, index) => {
    const name = `mutations[${index}]`
    if (!Array.isArray(value)) throw new Error(`${name}: expected a row array`)
    const operation = operationAt(value, numeric, name)
    const fields = OP_FIELDS[operation]
    const optional = operation === "setStyle" || operation === "setAnimation"
    const validLength = value.length === fields.length + 1 || (optional && value.length === fields.length)
    if (!validLength) throw new Error(`${name}: invalid positional arity`)
    const expanded: Record<string, unknown> = { op: operation }
    for (let i = 1; i < value.length; i += 1) {
      const field = fields[i - 1]
      if (field === undefined) throw new Error(`${name}: unexpected field ${i}`)
      expanded[field] = value[i]
    }
    return expanded as Mutation
  })
  return { v: 1, seq: raw[1], mutations }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function measure(work: () => number): Timing {
  for (let i = 0; i < WARMUP_ITERATIONS; i += 1) work()
  const samples: number[] = []
  let checksum = 0
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    let localChecksum = 0
    const start = performance.now()
    for (let i = 0; i < MEASURE_ITERATIONS; i += 1) localChecksum += work()
    const elapsedNs = (performance.now() - start) * 1_000_000
    samples.push(elapsedNs / MEASURE_ITERATIONS)
    checksum = (checksum + localChecksum) % 1_000_000_007
  }
  return {
    medianNsPerOp: Math.round(median(samples)),
    minNsPerOp: Math.round(Math.min(...samples)),
    maxNsPerOp: Math.round(Math.max(...samples)),
    checksum,
  }
}

function percentChange(candidate: number, baseline: number): number {
  return Number((((candidate - baseline) / baseline) * 100).toFixed(2))
}

function assertEquivalent(expected: MutationBatch, actual: MutationBatch, name: string): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`${name}: compact expansion changed batch semantics`)
  }
}

async function loadCases(): Promise<BenchmarkCase[]> {
  const cases: BenchmarkCase[] = []
  for (const fixture of FIXTURES) {
    const path = new URL(`../packages/protocol/fixtures/${fixture}`, import.meta.url)
    const raw: unknown = await Bun.file(path).json()
    const decoded = decodeBatch(JSON.stringify(raw))
    if (!decoded.ok) throw new Error(`${fixture}: fixture failed to decode: ${JSON.stringify(decoded.error)}`)
    const objectWire = encodeBatch(decoded.value)
    const stringWire = encodeCompact(decoded.value, false)
    const numericWire = encodeCompact(decoded.value, true)
    assertEquivalent(decoded.value, decodeCompact(stringWire, false), `${fixture}/string`)
    assertEquivalent(decoded.value, decodeCompact(numericWire, true), `${fixture}/numeric`)
    cases.push({
      name: fixture.replace(/^batch-/, "").replace(/\.json$/, ""),
      batch: decoded.value,
      objectWire,
      stringWire,
      numericWire,
    })
  }
  return cases
}

const results = new Map<string, Timings>()
const cases = await loadCases()
for (const entry of cases) {
  const wires: Record<Variant, string> = {
    object: entry.objectWire,
    string: entry.stringWire,
    numeric: entry.numericWire,
  }
  results.set(entry.name, {
    encode: {
      object: measure(() => encodeBatch(entry.batch).length),
      string: measure(() => encodeCompact(entry.batch, false).length),
      numeric: measure(() => encodeCompact(entry.batch, true).length),
    },
    parse: {
      object: measure(() => parsedShapeSize(JSON.parse(wires.object))),
      string: measure(() => parsedShapeSize(JSON.parse(wires.string))),
      numeric: measure(() => parsedShapeSize(JSON.parse(wires.numeric))),
    },
    decode: {
      object: measure(() => {
        const decoded = decodeBatch(wires.object)
        if (!decoded.ok) throw new Error(`${entry.name}: baseline decode failed`)
        return decoded.value.mutations.length
      }),
      string: measure(() => decodeCompact(wires.string, false).mutations.length),
      numeric: measure(() => decodeCompact(wires.numeric, true).mutations.length),
    },
  })
}

function aggregateTiming(key: "encode" | "decode" | "parse", variant: Variant): number {
  const values = cases.map((entry) => {
    const timings = results.get(entry.name)
    if (!timings) throw new Error(`missing timing for ${entry.name}`)
    return timings[key][variant].medianNsPerOp
  })
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

const totals = cases.reduce(
  (sum, entry) => ({
    object: sum.object + utf8Bytes(entry.objectWire),
    string: sum.string + utf8Bytes(entry.stringWire),
    numeric: sum.numeric + utf8Bytes(entry.numericWire),
  }),
  { object: 0, string: 0, numeric: 0 },
)

const aggregate = {
  bytes: totals,
  wireReductionPercent: {
    string: Number(((1 - totals.string / totals.object) * 100).toFixed(2)),
    numeric: Number(((1 - totals.numeric / totals.object) * 100).toFixed(2)),
  },
  medianNsPerOp: {
    encode: {
      object: aggregateTiming("encode", "object"),
      string: aggregateTiming("encode", "string"),
      numeric: aggregateTiming("encode", "numeric"),
    },
    parse: {
      object: aggregateTiming("parse", "object"),
      string: aggregateTiming("parse", "string"),
      numeric: aggregateTiming("parse", "numeric"),
    },
    decode: {
      object: aggregateTiming("decode", "object"),
      string: aggregateTiming("decode", "string"),
      numeric: aggregateTiming("decode", "numeric"),
    },
  },
}

const numericTimingRegression = {
  encodePercent: percentChange(aggregate.medianNsPerOp.encode.numeric, aggregate.medianNsPerOp.encode.object),
  decodePercent: percentChange(aggregate.medianNsPerOp.decode.numeric, aggregate.medianNsPerOp.decode.object),
}
const numericPasses =
  aggregate.wireReductionPercent.numeric >= MIN_WIRE_REDUCTION_PERCENT &&
  numericTimingRegression.encodePercent <= MAX_ENCODE_REGRESSION_PERCENT

const report = {
  schema: "p12-protocol-benchmark/v1",
  runtime: { bun: Bun.version },
  config: {
    fixtures: FIXTURES.length,
    warmupIterations: WARMUP_ITERATIONS,
    measureIterations: MEASURE_ITERATIONS,
    samples: SAMPLES,
    minWireReductionPercent: MIN_WIRE_REDUCTION_PERCENT,
    maxEncodeRegressionPercent: MAX_ENCODE_REGRESSION_PERCENT,
  },
  candidate: {
    envelope: "[v, seq, rows]",
    row: "[op, ...positionalFields]",
    variants: { string: "operation names", numeric: "numeric operation tags" },
    timingCaveat: "compact decode checks the envelope and row arity then expands generated rows; it is not yet a replacement for decodeBatch's full field validator",
  },
  cases: cases.map((entry) => {
    const timings = results.get(entry.name)
    if (!timings) throw new Error(`missing timing for ${entry.name}`)
    return {
      name: entry.name,
      mutations: entry.batch.mutations.length,
      bytes: {
        object: utf8Bytes(entry.objectWire),
        string: utf8Bytes(entry.stringWire),
        numeric: utf8Bytes(entry.numericWire),
      },
      timingNsPerOp: timings,
    }
  }),
  aggregate,
  decision: {
    numericTimingRegression,
    gate: {
      wireReductionPass: aggregate.wireReductionPercent.numeric >= MIN_WIRE_REDUCTION_PERCENT,
      encodeRegressionPass: numericTimingRegression.encodePercent <= MAX_ENCODE_REGRESSION_PERCENT,
      decodeIsInformational: true,
    },
    recommendation: numericPasses
      ? "benchmark supports designing P12; do not change the wire contract in this benchmark"
      : "keep the object wire format; benchmark does not meet the P12 threshold",
  },
}

console.log(JSON.stringify(report, null, 2))
