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

/// <reference path="./benchmark-compiler-types.d.ts" />

import { unlink, writeFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { transformSync } from "@babel/core"
import solidPlugin from "@solidjs/babel-plugin"
import { createSignal } from "solid-js"
import {
  MUTATION_OPS,
  type MutationBatch,
  type MutationOp,
} from "@solid-gpui/protocol"
import { initJsxRuntime, resetJsxRuntime } from "../packages/solid/src/jsx"
import { makeH, type H } from "../packages/solid/src/h"
import {
  createSolidRenderer,
  type HostNode,
  type Send,
} from "../packages/solid/src/renderer"

const ROWS = 200
const WARMUP_UPDATES = 10
const MEASURED_UPDATES = 50
const TRANSFORM_WARMUP = 5
const TRANSFORM_MEASURED = 20
const GENERATED_MODULE = ".pi/compiler-benchmark-generated.mjs"

const JSX_SOURCE = `export function build(value) {
  const rows = []
  for (let row = 0; row < ${ROWS}; row += 1) {
    rows.push(<div style={{ height: 22 }}>{value()}</div>)
  }
  return <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{rows}</div>
}
`

type Build = (value: () => string) => HostNode
type RendererSuite = ReturnType<typeof createSolidRenderer>

type Distribution = {
  readonly count: number
  readonly min: number
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly max: number
  readonly mean: number
}

type VariantReport = {
  readonly name: string
  readonly mount: {
    readonly latencyMs: number
    readonly batches: number
    readonly mutations: number
    readonly operations: Partial<Record<MutationOp, number>>
    readonly signature: string
  }
  readonly updates: {
    readonly count: number
    readonly latencyMs: Distribution
    readonly batchMutations: Distribution
    readonly operations: Partial<Record<MutationOp, number>>
    readonly signature: string
  }
  readonly cleanupMutations: number
}

type PublicVariantReport = {
  readonly name: string
  readonly mount: Omit<VariantReport["mount"], "signature">
  readonly updates: Omit<VariantReport["updates"], "signature">
  readonly cleanupMutations: number
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

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
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

function mutationSignature(batches: readonly MutationBatch[]): string {
  return JSON.stringify(batches.map((batch) => batch.mutations))
}

function recording(): { readonly batches: MutationBatch[]; readonly send: Send } {
  const batches: MutationBatch[] = []
  return {
    batches,
    send: async (batch) => {
      batches.push(batch)
      return { seq: batch.seq, applied: batch.mutations.length }
    },
  }
}

function takeSingleBatch(
  batches: MutationBatch[],
  variant: string,
  phase: string,
): MutationBatch {
  const pending = batches.splice(0)
  if (pending.length !== 1) {
    throw new Error(`${variant}: ${phase} emitted ${pending.length} batches; expected exactly one`)
  }
  const batch = pending[0]
  if (!batch) throw new Error(`${variant}: ${phase} emitted no batch`)
  return batch
}

async function exercise(
  name: string,
  build: Build,
  suite: RendererSuite,
  batches: MutationBatch[],
): Promise<VariantReport> {
  const container = suite.renderer.createElement("#root")
  const [value, setValue] = createSignal("initial")
  const mountStarted = performance.now()
  const dispose = suite.render(() => build(value), container)
  await suite.flush()
  const mountLatencyMs = performance.now() - mountStarted
  const mountBatches = batches.splice(0)
  if (mountBatches.length === 0) throw new Error(`${name}: mount emitted no batch`)

  for (let step = 0; step < WARMUP_UPDATES; step += 1) {
    setValue(`warmup-${step}`)
    await suite.flush()
    takeSingleBatch(batches, name, `warmup update ${step}`)
  }

  const updateLatencies: number[] = []
  const updateBatches: MutationBatch[] = []
  for (let step = 0; step < MEASURED_UPDATES; step += 1) {
    const started = performance.now()
    setValue(`value-${step}`)
    await suite.flush()
    updateLatencies.push(performance.now() - started)
    updateBatches.push(takeSingleBatch(batches, name, `measured update ${step}`))
  }

  dispose()
  await suite.flush()
  const cleanupBatches = batches.splice(0)
  return {
    name,
    mount: {
      latencyMs: rounded(mountLatencyMs),
      batches: mountBatches.length,
      mutations: mountBatches.reduce((sum, batch) => sum + batch.mutations.length, 0),
      operations: countOperations(mountBatches),
      signature: mutationSignature(mountBatches),
    },
    updates: {
      count: updateBatches.length,
      latencyMs: distribution(updateLatencies),
      batchMutations: distribution(updateBatches.map((batch) => batch.mutations.length)),
      operations: countOperations(updateBatches),
      signature: mutationSignature(updateBatches),
    },
    cleanupMutations: cleanupBatches.reduce((sum, batch) => sum + batch.mutations.length, 0),
  }
}

function publicVariant(result: VariantReport): PublicVariantReport {
  return {
    name: result.name,
    mount: {
      latencyMs: result.mount.latencyMs,
      batches: result.mount.batches,
      mutations: result.mount.mutations,
      operations: result.mount.operations,
    },
    updates: {
      count: result.updates.count,
      latencyMs: result.updates.latencyMs,
      batchMutations: result.updates.batchMutations,
      operations: result.updates.operations,
    },
    cleanupMutations: result.cleanupMutations,
  }
}

function runtimeBuilder(renderer: RendererSuite["renderer"]): Build {
  const h: H = makeH(renderer)
  return (value) => {
    const rows: HostNode[] = []
    for (let row = 0; row < ROWS; row += 1) {
      rows.push(
        h(
          "div",
          { style: { height: 22 } },
          () => value(),
        ),
      )
    }
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 2 } }, ...rows)
  }
}

async function runRuntime(): Promise<VariantReport> {
  const recorded = recording()
  const suite = createSolidRenderer(recorded.send)
  return exercise("runtime-h", runtimeBuilder(suite.renderer), suite, recorded.batches)
}

async function runCompiled(build: Build): Promise<VariantReport> {
  const recorded = recording()
  const suite = initJsxRuntime(recorded.send)
  try {
    return await exercise("compiled-jsx", build, suite, recorded.batches)
  } finally {
    resetJsxRuntime()
  }
}

function compile(): string {
  const output = transformSync(JSX_SOURCE, {
    filename: fileURLToPath(new URL("../.pi/compiler-benchmark-source.tsx", import.meta.url)),
    plugins: [[solidPlugin, { moduleName: "@solid-gpui/solid/jsx", generate: "universal" }]],
    parserOpts: { plugins: ["jsx", "typescript"] },
  })
  if (!output?.code) throw new Error("compiler returned no JavaScript output")
  return output.code
}

function measureCompilation(): { readonly code: string; readonly timingMs: Distribution } {
  for (let i = 0; i < TRANSFORM_WARMUP; i += 1) compile()
  const timings: number[] = []
  let code = ""
  for (let i = 0; i < TRANSFORM_MEASURED; i += 1) {
    const started = performance.now()
    code = compile()
    timings.push(performance.now() - started)
  }
  return { code, timingMs: distribution(timings) }
}

function compiledHelperNames(code: string): string[] {
  const names: string[] = []
  for (const match of code.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*["']@solid-gpui\/solid\/jsx["']/g,
  )) {
    for (const binding of (match[1] ?? "").split(",")) {
      const name = binding.trim().split(/\s+as\s+/)[0]
      if (name) names.push(name)
    }
  }
  return [...new Set(names)].sort()
}

async function packageVersion(name: string): Promise<string> {
  try {
    const raw: unknown = await Bun.file(
      new URL(`../node_modules/${name}/package.json`, import.meta.url),
    ).json()
    if (typeof raw !== "object" || raw === null) return "unavailable"
    const version = (raw as { readonly version?: unknown }).version
    return typeof version === "string" ? version : "unavailable"
  } catch {
    return "unavailable"
  }
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const generated = resolve(root, GENERATED_MODULE)
const compilation = measureCompilation()
await writeFile(generated, compilation.code)

let compiledModule: { readonly build?: unknown }
try {
  compiledModule = (await import(`${pathToFileURL(generated).href}?benchmark=1`)) as {
    readonly build?: unknown
  }
} finally {
  await unlink(generated).catch(() => undefined)
}
if (typeof compiledModule.build !== "function") {
  throw new Error("compiled JSX module did not export build(value)")
}
const compiledBuilder = compiledModule.build as Build
const compiled = await runCompiled(compiledBuilder)
const runtime = await runRuntime()

const mountOperationParity =
  JSON.stringify(compiled.mount.operations) === JSON.stringify(runtime.mount.operations)
const updateOperationParity =
  JSON.stringify(compiled.updates.operations) === JSON.stringify(runtime.updates.operations)
const report = {
  schema: "solid-gpui-compiler-benchmark/v1",
  mode: "headless-recording-send",
  runtime: {
    bun: Bun.version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    conditions: "browser",
    solid: await packageVersion("solid-js"),
    universal: await packageVersion("@solidjs/universal"),
    babelPlugin: await packageVersion("@solidjs/babel-plugin"),
    babelCore: await packageVersion("@babel/core"),
  },
  config: {
    rows: ROWS,
    warmupUpdates: WARMUP_UPDATES,
    measuredUpdates: MEASURED_UPDATES,
    transformWarmup: TRANSFORM_WARMUP,
    transformMeasured: TRANSFORM_MEASURED,
  },
  compiledOutput: {
    sourceUtf8Bytes: utf8Bytes(JSX_SOURCE),
    javascriptUtf8Bytes: utf8Bytes(compilation.code),
    transformMs: compilation.timingMs,
    helperImports: compiledHelperNames(compilation.code),
    createElementCallSites: (compilation.code.match(/\b_\$createElement\b/g) ?? []).length,
    insertCallSites: (compilation.code.match(/\b_\$insert\b/g) ?? []).length,
  },
  mutationParity: {
    mountOperations: mountOperationParity,
    updateOperations: updateOperationParity,
    mountExact: compiled.mount.signature === runtime.mount.signature,
    updatesExact: compiled.updates.signature === runtime.updates.signature,
  },
  paths: { compiled: publicVariant(compiled), runtime: publicVariant(runtime) },
  boundaries: {
    compiler: "@solidjs/babel-plugin transformSync, generate=universal",
    runtime: "compiled module or makeH builder through the same createSolidRenderer and flush",
    send: "recording send; no helper process, JSON IPC, GPUI layout/paint, or window startup",
    excluded: "helper/GPUI host work, real IPC, memory, and GUI presentation",
  },
}

console.log(JSON.stringify(report, null, 2))
