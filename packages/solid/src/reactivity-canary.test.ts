/**
 * Tests for the mount-time reactivity canary: the solid-js SSR stub (the
 * default `node` export condition) runs effects once and never again, which
 * freezes every UI silently. The canary's job is to turn that silent freeze
 * into a named error at mount.
 * @.mod solid-gpui
 */
import { describe, expect, test } from "bun:test"
import { assertReactivityLive, type CanaryDeps } from "./reactivity-canary"

/** Real solid-js under the browser condition: reactive. */
const realDeps = async () => {
  const solid = await import("solid-js")
  return {
    createRoot: solid.createRoot,
    createSignal: solid.createSignal,
    createEffect: solid.createEffect,
    flush: solid.flush,
  }
}

/**
 * Simulates the server stub: `createEffect(compute, effect)` drops the
 * effect callback entirely (server.js: serverEffect(compute, undefined)) —
 * the compute runs once, the effect never.
 */
const stubDeps = (): CanaryDeps => {
  return {
    createRoot: (fn: (d: () => void) => unknown) => fn(() => {}),
    createSignal: (initial: number) => {
      let v = initial
      return [
        () => v,
        (n: number) => {
          v = n
        },
      ]
    },
    createEffect: (compute: () => unknown) => {
      compute()
    },
    flush: async () => {},
  }
}

describe("reactivity canary", () => {
  test("real solid-js under the browser condition passes", async () => {
    await expect(assertReactivityLive(await realDeps())).resolves.toBeUndefined()
  })

  test("the non-reactive SSR stub throws with the fix named", async () => {
    let caught: unknown
    try {
      await assertReactivityLive(stubDeps())
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toMatch(/--conditions=browser/)
  })
})
