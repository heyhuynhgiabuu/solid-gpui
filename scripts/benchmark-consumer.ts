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

/**
 * Gate 6: end-to-end latency against the REPRESENTATIVE Gate 0 consumer
 * fixture (the SaaS screen) on a real helper in transport mode (headless).
 *
 * Measures signal→flush→ack latency distributions per interaction class
 * (text update, input edit, option selection) plus the mount ack. This is
 * the whole bridge EXCEPT Solid's internal scheduling granularity (flush()
 * drains it) and GPUI layout/paint (no window in transport mode — those
 * stay owned by the helper-side benchmarks).
 *
 * No thresholds: Gate 6 policy accepts optimizations only against measured
 * regressions, and CI thresholds wait for cross-runner stability.
 */
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spawnHelper } from "../packages/client/src/index"
import { render, type RenderHandle } from "../packages/solid/src/render"
import { acceptanceActions, screen } from "../tests/consumer-h/fixture"

const WARMUP = 10
const MEASURED = 100

const helperPath = fileURLToPath(new URL("../target/debug/solid-gpui-helper", import.meta.url))
if (!existsSync(helperPath)) {
  throw new Error(`helper binary missing at ${helperPath}; run cargo build -p solid-gpui-helper first`)
}

function percentile(sortedAscending: number[], fraction: number): number {
  if (sortedAscending.length === 0) return Number.NaN
  const index = Math.min(sortedAscending.length - 1, Math.floor(fraction * sortedAscending.length))
  return Math.round(sortedAscending[index]! * 1000) / 1000
}

function distribution(samples: number[]): { n: number; p50Ms: number; p95Ms: number; p99Ms: number } {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    n: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  }
}

let handle: RenderHandle | undefined
try {
  const connection = spawnHelper({ binary: helperPath, mode: "transport" })
  handle = await render(screen, { connection })
  await handle.renderer.flush()

  const stats = (await connection.sendCommand({ type: "getStats", seq: 9_000 })) as Record<
    string,
    unknown
  >
  const actions = acceptanceActions()

  /** Measure one interaction class: warmup, then signal→flush→ack latency. */
  async function measure(name: string, fire: () => void): Promise<Record<string, unknown>> {
    for (let i = 0; i < WARMUP; i += 1) {
      fire()
      await handle?.renderer.flush()
    }
    const samples: number[] = []
    for (let i = 0; i < MEASURED; i += 1) {
      const started = performance.now()
      fire()
      await handle.renderer!.flush()
      samples.push(performance.now() - started)
    }
    return { interaction: name, ...distribution(samples) }
  }

  // Each action flips distinct state so EVERY measured flush carries real
  // mutations: increment toggles counter text; editQuery always changes the
  // value; option-select alternates two colors deterministically (a random
  // color could equal the current one and produce a no-op flush, poisoning
  // the distribution with a different population — review pass 1).
  let toggle = false
  const interactions = [
    await measure("action-increment", () => actions.increment()),
    await measure("input-edit", () => actions.editQuery(`query-${Math.random()}`)),
    await measure("option-select", () => {
      toggle = !toggle
      actions.chooseColor(toggle ? "blue" : "green")
    }),
  ]

  await handle.dispose()
  await connection.close()
  const exit = await connection.exited
  if (exit.code !== 0 || exit.signal !== null) {
    throw new Error(`helper exited unexpectedly: ${JSON.stringify(exit)}`)
  }

  const report = {
    schema: "solid-gpui-consumer-benchmark/v1",
    mode: "headless-real-client-helper",
    gui: false,
    fixture: "tests/consumer-h/fixture.ts (Gate 0 SaaS screen)",
    environment: {
      bun: Bun.version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      helperVersion: stats.helperVersion,
      protocolVersion: stats.protocolVersion,
    },
    config: { warmup: WARMUP, measured: MEASURED },
    interactions,
    boundaries: {
      included: "signal update -> flush() -> client encode/write -> helper decode/apply/ack -> client correlation",
      excluded: "GPUI layout/paint (no window in transport mode); mount cost (one-shot, owned by the lifecycle benchmark)",
    },
  }
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  if (handle) await handle.dispose()
  throw error
}
