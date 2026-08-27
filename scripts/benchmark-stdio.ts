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

import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spawnHelper } from "../packages/client/src/index"
import {
  decodeBatch,
  encodeBatch,
  type MutationBatch,
  type MutationOp,
} from "@solid-gpui/protocol"

const SERIALIZATION_WARMUP = 500
const SERIALIZATION_ITERATIONS = 2_000
const SERIALIZATION_SAMPLES = 5
const TRANSPORT_WARMUP_REQUESTS = 5
const TRANSPORT_MEASURED_REQUESTS = 50
const CHECKSUM_MODULUS = 1_000_000_007

type Distribution = {
  readonly count: number
  readonly min: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
  readonly mean: number
}

type Timed = {
  readonly distribution: Distribution
  readonly checksum: number
}

type FixtureMetadata = {
  readonly name: string
  readonly mutations: number
  readonly operations: Partial<Record<MutationOp, number>>
}

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

function measureSync(work: () => number): Timed {
  for (let i = 0; i < SERIALIZATION_WARMUP; i += 1) work()
  const timings: number[] = []
  let checksum = 0
  for (let sample = 0; sample < SERIALIZATION_SAMPLES; sample += 1) {
    let localChecksum = 0
    const started = performance.now()
    for (let iteration = 0; iteration < SERIALIZATION_ITERATIONS; iteration += 1) {
      localChecksum += work()
    }
    timings.push((performance.now() - started) / SERIALIZATION_ITERATIONS)
    checksum = (checksum + localChecksum) % CHECKSUM_MODULUS
  }
  return { distribution: distribution(timings), checksum }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function decodeFixture(json: string): MutationBatch {
  const decoded = decodeBatch(json)
  if (!decoded.ok) throw new Error(`batch-01.json failed to decode: ${JSON.stringify(decoded.error)}`)
  return decoded.value
}

function operationCounts(batch: MutationBatch): Partial<Record<MutationOp, number>> {
  const counts: Partial<Record<MutationOp, number>> = {}
  for (const mutation of batch.mutations) {
    counts[mutation.op] = (counts[mutation.op] ?? 0) + 1
  }
  return counts
}

async function loadFixture(): Promise<{ batch: MutationBatch; metadata: FixtureMetadata; wire: string }> {
  const json = await Bun.file(new URL("../packages/protocol/fixtures/batch-01.json", import.meta.url)).text()
  const batch = decodeFixture(json)
  return {
    batch,
    metadata: {
      name: "batch-01.json",
      mutations: batch.mutations.length,
      operations: operationCounts(batch),
    },
    wire: encodeBatch(batch),
  }
}

function serializationReport(batch: MutationBatch, wire: string) {
  const encode = measureSync(() => encodeBatch(batch).length)
  const decode = measureSync(() => {
    const decoded = decodeBatch(wire)
    if (!decoded.ok) throw new Error(`serialization benchmark decode failed: ${JSON.stringify(decoded.error)}`)
    return decoded.value.mutations.length
  })
  return {
    fixtureWireUtf8Bytes: utf8Bytes(wire),
    encodeMsPerOperation: encode.distribution,
    decodeMsPerOperation: decode.distribution,
    checksums: { encode: encode.checksum, decode: decode.checksum },
  }
}

async function transportReport(batch: MutationBatch) {
  const binary = fileURLToPath(new URL("../target/debug/solid-gpui-helper", import.meta.url))
  if (!existsSync(binary)) {
    throw new Error(`helper binary missing at ${binary}; run cargo build -p solid-gpui-helper first`)
  }

  const helper = spawnHelper({ binary, mode: "transport" })
  const request = (seq: number): MutationBatch => ({ ...batch, seq })
  const sendAndCheck = async (requestBatch: MutationBatch): Promise<number> => {
    const ack = await helper.sendBatch(requestBatch)
    if (ack.seq !== requestBatch.seq) {
      throw new Error(`ack sequence mismatch: expected ${requestBatch.seq}, got ${ack.seq}`)
    }
    if (ack.applied !== batch.mutations.length) {
      throw new Error(`ack applied mismatch: expected ${batch.mutations.length}, got ${ack.applied}`)
    }
    return ack.applied
  }

  try {
    for (let i = 0; i < TRANSPORT_WARMUP_REQUESTS; i += 1) {
      await sendAndCheck(request(1_000_000 + i))
    }

    const latencies: number[] = []
    const bytes: number[] = []
    let acknowledged = 0
    for (let i = 0; i < TRANSPORT_MEASURED_REQUESTS; i += 1) {
      const requestBatch = request(2_000_000 + i)
      const requestWire = encodeBatch(requestBatch)
      const started = performance.now()
      acknowledged += await sendAndCheck(requestBatch)
      latencies.push(performance.now() - started)
      bytes.push(utf8Bytes(requestWire))
    }

    await helper.close()
    const exit = await helper.exited
    if (exit.code !== 0 || exit.signal !== null) {
      throw new Error(`helper exited unexpectedly: ${JSON.stringify(exit)}`)
    }
    return {
      mode: "stdio",
      binary,
      warmupRequests: TRANSPORT_WARMUP_REQUESTS,
      measuredRequests: TRANSPORT_MEASURED_REQUESTS,
      acknowledgedMutations: acknowledged,
      expectedMutations: batch.mutations.length * TRANSPORT_MEASURED_REQUESTS,
      sequenceCorrelation: true,
      requestUtf8Bytes: distribution(bytes),
      roundTripMs: distribution(latencies),
    }
  } catch (error) {
    helper.kill()
    await helper.exited
    throw error
  }
}

const fixture = await loadFixture()
const report = {
  schema: "solid-gpui-stdio-benchmark/v1",
  mode: "headless-real-client-helper",
  runtime: {
    bun: Bun.version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  fixture: fixture.metadata,
  config: {
    serializationWarmup: SERIALIZATION_WARMUP,
    serializationIterations: SERIALIZATION_ITERATIONS,
    serializationSamples: SERIALIZATION_SAMPLES,
    transportWarmupRequests: TRANSPORT_WARMUP_REQUESTS,
    transportMeasuredRequests: TRANSPORT_MEASURED_REQUESTS,
  },
  serialization: serializationReport(fixture.batch, fixture.wire),
  transport: await transportReport(fixture.batch),
  boundaries: {
    serialization: "encodeBatch/decodeBatch in this Bun process",
    transport: "client encode/write -> helper decode/apply/ack -> client readline/decode/correlation",
    excluded: "Solid scheduling, GPUI layout/paint, and GUI/window startup",
  },
}

console.log(JSON.stringify(report, null, 2))
