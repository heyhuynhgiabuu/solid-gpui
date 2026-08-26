/**
 * Wire-safety probes (approved technical slice 1): the failure/poison/version/
 * sequence guarantees proven through the REAL client→helper pipe, not a
 * recording mock. The renderer's `send` seam is the live HelperConnection.
 *
 * Transport-mode tests need only the built helper binary (no GUI). Window-mode
 * tests need a real GPUI window and skip like perf.test.ts when the GUI is
 * unavailable.
 */
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spawnHelper, HelperExitedError, ReplyError } from "@solid-gpui/client"
import { createSolidRenderer, type Send } from "./renderer"

const binary = fileURLToPath(
  new URL("../../../target/debug/solid-gpui-helper", import.meta.url),
)
const noBinary = !existsSync(binary)
if (noBinary) {
  console.warn(`helper binary missing at ${binary} — run cargo build -p solid-gpui-helper`)
}
const noGui = process.env.SOLID_GPUI_SKIP_GUI_TESTS !== undefined

describe.skipIf(noBinary)("wire safety via real helper (transport mode)", () => {
  test("helper death poisons the renderer; later flushes reject WITHOUT requeue", async () => {
    const helper = spawnHelper({ binary })
    let sends = 0
    const send: Send = async (batch) => {
      sends++
      return helper.sendBatch(batch)
    }
    const { renderer: R, render, flush } = createSolidRenderer(send)
    const container = R.createElement("#root")
    const dispose = render(() => R.createElement("div"), container)
    await flush()
    expect(sends).toBe(1)

    // Real death: SIGTERM the helper and wait for the exit event (the client
    // resolves `exited` after stdio drains).
    helper.kill()
    await helper.exited
    expect((await helper.exited).signal).not.toBeNull()

    // A queued mutation flush learns about the death from the client's
    // sendBatch rejection (HelperExitedError) and poisons the renderer.
    R.createElement("div") // queues a mutation
    await expect(flush()).rejects.toThrow(HelperExitedError)
    expect(sends).toBe(2)

    // Poisoned: the next flush rejects WITHOUT calling send again — no
    // requeue of a batch that may have partially applied (policy: poison
    // and remount; re-sending could double-apply).
    R.createElement("div")
    await expect(flush()).rejects.toThrow(/poisoned/i)
    expect(sends).toBe(2)

    // Dispose path still runs (its flush also rejects, but must not hang).
    dispose()
  })

  test("a normal session still acks with an honest applied count", async () => {
    const helper = spawnHelper({ binary })
    let ackApplied = 0
    const send: Send = async (batch) => {
      const ack = await helper.sendBatch(batch)
      ackApplied = ack.applied
      return ack
    }
    const { renderer: R, render, flush } = createSolidRenderer(send)
    const container = R.createElement("#root")
    const dispose = render(() => {
      const root = R.createElement("div")
      const label = R.createTextNode("hi")
      R.insertNode(root, label)
      return root
    }, container)
    await flush()
    // createElement + createElement + setText + appendChild + setRoot = 5.
    expect(ackApplied).toBe(5)
    dispose()
    await helper.close()
    expect((await helper.exited).code).toBe(0)
  })
})

describe.skipIf(noBinary || noGui)("wire safety via real helper (window mode)", () => {
  test("a real applyFailed reply poisons the renderer; honest count; dispose closes cleanly", async () => {
    const helper = spawnHelper({ binary, mode: "window" })
    let sends = 0
    const acks: number[] = []
    const send: Send = async (batch) => {
      sends++
      const ack = await helper.sendBatch(batch)
      acks.push(ack.applied)
      return ack
    }
    const { renderer: R, render, flush } = createSolidRenderer(send)
    const container = R.createElement("#root")
    let parent: ReturnType<typeof R.createElement> | undefined
    let child: ReturnType<typeof R.createElement> | undefined
    const dispose = render(() => {
      parent = R.createElement("div")
      child = R.createElement("div")
      R.insertNode(parent, child)
      return parent
    }, container)
    await flush()
    expect(sends).toBe(1)
    // The mount batch went through the real retained tree: 4 mutations, all
    // applied (honest ack count, AGENTS invariant 1).
    expect(acks).toEqual([4])

    // Wire-invalid misuse the renderer's guards deliberately do not catch:
    // inserting a node that ALREADY has a parent on the wire. The shadow
    // bookkeeping follows the caller, but the helper's retained tree rejects
    // the attach (child already has a parent) — a real seq-correlated
    // applyFailed reply reaches the renderer as ReplyError.
    const other = R.createElement("div") // applies fine (1)
    R.insertNode(other!, child!) // rejected by the helper
    let failure: unknown
    try {
      await flush()
    } catch (err) {
      failure = err
    }
    expect(failure).toBeInstanceOf(ReplyError)
    expect((failure as ReplyError).code).toBe("applyFailed")
    // The helper's message names the honest partial count: the createElement
    // applied, the appendChild did not.
    expect((failure as ReplyError).message).toContain("after 1 mutations")
    expect((failure as ReplyError).message).toContain("already has a parent")
    expect(sends).toBe(2)

    // Poisoned: later flushes reject without requeueing.
    R.createElement("div")
    await expect(flush()).rejects.toThrow(/poisoned/i)
    expect(sends).toBe(2)

    // Dispose still runs; the helper window closes cleanly on EOF.
    dispose()
    await helper.close()
    expect((await helper.exited).code).toBe(0)
  })
})