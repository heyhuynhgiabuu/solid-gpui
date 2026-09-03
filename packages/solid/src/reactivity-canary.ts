/*
 * Copyright 2026 the solid-gpui authors
 *
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
 * Mount-time reactivity canary.
 *
 * solid-js@2 publishes a server build under Node's own export condition
 * (upstream solidjs/solid#2569): `createEffect(compute, effect)` drops the
 * effect callback entirely there, so an app that gets it mounts once and then
 * freezes with no error anywhere. The docs shout about the browser condition;
 * this canary makes the failure speak for itself — a throw at mount naming
 * the exact fix — so nobody has to debug a frozen UI from first principles.
 *
 * The deps are injectable so tests can simulate the server stub without
 * needing it in the test graph.
 */
import {
  createRoot,
  createSignal,
  createEffect,
  flush as flushSolid,
} from "solid-js"

export interface CanaryDeps {
  createRoot: (fn: (dispose: () => void) => unknown) => unknown
  createSignal: (initial: number) => [() => number, (n: number) => void]
  // Exact engine signature (rc.6 removed the one-arg overload). Structural
  // stand-ins lose to the async-tolerant ComputeFunction under strict
  // function types; the server-stub fake in the test asserts its way in with
  // a comment instead.
  createEffect: typeof createEffect
  flush: () => Promise<void> | void
}

const realDeps = (): CanaryDeps => ({
  createRoot,
  createSignal,
  createEffect,
  flush: flushSolid as () => Promise<void>,
})

/**
 * Verify that a signal write re-runs an effect under the caller's module
 * resolution. Resolves when reactive; throws with the fix when the resolved
 * solid-js is the server build.
 *
 * Mechanics: inside one throwaway root, a compute/effect pair counts the
 * effect runs after an `armed` flag flips; the signal is written before the
 * flush. Real solid re-runs the effect (runs ≥ 1 after one flush); the server
 * build drops the effect callback entirely, so `runs` stays 0.
 */
export async function assertReactivityLive(
  deps: CanaryDeps = realDeps(),
): Promise<void> {
  let runs = 0
  let armed = false
  const dispose = deps.createRoot((disposeRoot) => {
    const [sig, set] = deps.createSignal(0)
    deps.createEffect(
      () => ({ value: sig(), armed }),
      ({ armed: isArmed }) => {
        if (isArmed) runs++
      },
    )
    armed = true
    set(1)
    return disposeRoot
  }) as (() => void) | undefined
  try {
    await deps.flush()
  } finally {
    dispose?.()
  }

  if (runs === 0) {
    throw new Error(
      "[solid-gpui] solid-js resolved to the non-reactive server build " +
        "(effects never re-run; upstream solidjs/solid#2569). " +
        "Re-run with the browser condition: " +
        "`bun --conditions=browser …` or `node --conditions=browser …` " +
        "(or NODE_OPTIONS=--conditions=browser).",
    )
  }
}
