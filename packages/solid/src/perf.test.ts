/**
 * S7c perf harness: mounts a 200-row tree through the real window-mode
 * helper, drives repeated updates, then reads FrameStats over the wire via
 * getStats and asserts a p95 build-time budget.
 *
 * Skips automatically when SOLID_GPUI_SKIP_GUI_TESTS is set or the helper
 * binary has not been built (e.g. the Linux CI job) — this test needs a real
 * GPUI window.
 */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { createSignal } from "solid-js"
import { HelperExitedError } from "@solid-gpui/client"
import { render, type RenderHandle } from "./render"

const ROWS = 200
const UPDATES = 30
/** Generous by design: catches gross regressions (accidental full-tree diff,
 * O(n²) walks), not noise. Local measurements sit far below this. */
const P95_BUDGET_MS = 10

const helperBinary = new URL(
  "../../../target/debug/solid-gpui-helper",
  import.meta.url,
)

function shouldSkip(): boolean {
  if (process.env.SOLID_GPUI_SKIP_GUI_TESTS !== undefined) return true
  return !existsSync(helperBinary)
}

describe.skipIf(shouldSkip())("perf harness (window-mode helper)", () => {
  test(`200-row tree: ${UPDATES} updates keep p95 build under ${P95_BUDGET_MS}ms`, async () => {
    let setTick!: (fn: (c: number) => number) => void
    let handle!: RenderHandle
    try {
      handle = await render((h) => {
        const rows = []
        for (let i = 0; i < ROWS; i++) {
          rows.push(
            h(
              "div",
              { style: { display: "flex", padding: 4, gap: 8 } },
              h("div", { style: { fontSize: 14 } }, () => `Row ${i}`),
            ),
          )
        }
        const [tick, set] = createSignal(0)
        setTick = set
        rows.push(h("div", { style: { fontSize: 16 } }, () => `ticks: ${tick()}`))
        return h(
          "div",
          { style: { display: "flex", flexDirection: "column", padding: 8 } },
          ...rows,
        )
      })
    } catch (err) {
      // Bun throws synchronously on ENOENT wrapped as HelperExitedError with a
      // spawnError — treat as skip, same as a missing binary probe.
      if (err instanceof HelperExitedError && err.spawnError !== undefined) {
        console.warn("perf harness: helper not built; skipping")
        return
      }
      throw err
    }

    expect(typeof setTick).toBe("function")

    // Drive updates paced ~1/frame so each becomes its own draw; gpui
    // coalesces back-to-back notifies by design (that is the point of a
    // retained tree), so an unpaced loop would collapse into one frame.
    for (let i = 1; i <= UPDATES; i++) {
      setTick(() => i)
      await handle.renderer.flush()
      await new Promise((r) => setTimeout(r, 16))
    }

    // Read stats back over the wire (exercises the S7b command family).
    // sendCommand resolves with the Result payload directly.
    const value = (await handle.connection.sendCommand({
      type: "getStats",
      seq: 900_001,
    })) as Record<string, unknown>
    const p95Ms = value.p95Ms
    expect(typeof p95Ms).toBe("number")
    // Coalescing may merge some frames; half the updates must have drawn.
    expect(Number(value.frames)).toBeGreaterThanOrEqual(Math.floor(UPDATES / 2))

    console.log(
      `perf: frames=${value.frames} p50=${value.p50Ms}ms p95=${p95Ms}ms max=${value.maxMs}ms`,
    )
    expect(Number(p95Ms)).toBeLessThan(P95_BUDGET_MS)

    await handle.dispose()
  })
})
