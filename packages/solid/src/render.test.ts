import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import type { MutationBatch, SolidGpuiEvent } from "@solid-gpui/protocol"
import type { ExitInfo, HelperConnection } from "@solid-gpui/client"
import { render } from "./render"

/** Connection double: records batches, captures the event listener so tests
 * can fire helper-side events without a GUI process. */
function fakeConnection() {
  const batches: MutationBatch[] = []
  let onEventCb: ((ev: SolidGpuiEvent) => void) | undefined
  const conn = {
    sendBatch: async (b: MutationBatch) => {
      batches.push(b)
      return { seq: b.seq, applied: b.mutations.length }
    },
    onEvent: (cb: (ev: SolidGpuiEvent) => void) => {
      onEventCb = cb
      return () => {}
    },
    close: async () => {},
    exited: Promise.resolve({ code: 0, signal: null } satisfies ExitInfo),
  }
  return {
    connection: conn as unknown as HelperConnection,
    batches,
    fireClick: (id: number) => onEventCb?.({ type: "event", id, eventType: "click" }),
    fireKey: (id: number) =>
      onEventCb?.({
        type: "event",
        id,
        eventType: "keyDown",
        key: "Enter",
        modifiers: { ctrl: true, alt: false, shift: false, cmd: false },
      }),
  }
}

describe("render(): event backchannel wiring", () => {
  test("a routed click invokes its handler AND flushes resulting mutations", async () => {
    const fake = fakeConnection()
    const [count, setCount] = createSignal(0)

    const handle = await render(
      (h) =>
        h(
          "div",
          {
            style: { display: "flex", flexDirection: "column" },
            onClick: () => setCount((c) => c + 1),
          },
          () => `Count: ${count()}`,
        ),
      // Connection double satisfies the surface used by render(); the cast
      // keeps the test focused instead of reimplementing the full class.
      { connection: fake.connection as HelperConnection },
    )

    const mountOps = fake.batches[0]!.mutations.map((m) => m.op)
    expect(mountOps).toContain("setEventListener")

    // The element carrying onClick is the first user element (container=1,
    // div=2): fire a helper-side click at it.
    fake.fireClick(2)

    // Let the scheduled post-handler flush run.
    await new Promise((r) => setTimeout(r, 20))

    expect(count()).toBe(1)
    const followUp = fake.batches.slice(1).flatMap((b) => b.mutations.map((m) => m.op))
    expect(followUp).toContain("setText") // Count: 0 -> Count: 1 crossed IPC

    await handle.dispose()
  })

  test("a throwing onClick handler does not break routing or the flush", async () => {
    const fake = fakeConnection()
    const [count, setCount] = createSignal(0)

    const handle = await render(
      (h) =>
        h(
          "div",
          {
            onClick: () => {
              setCount((c) => c + 1)
              throw new Error("boom")
            },
          },
          () => `Count: ${count()}`,
        ),
      { connection: fake.connection as HelperConnection },
    )

    // Must not throw synchronously out of onEvent (readline callback) —
    // an uncaught error here would kill the host process.
    fake.fireClick(2)
    await new Promise((r) => setTimeout(r, 20))

    // State change applied BEFORE the throw still crosses the wire.
    expect(count()).toBe(1)
    const followUp = fake.batches.slice(1).flatMap((b) => b.mutations.map((m) => m.op))
    expect(followUp).toContain("setText")

    await handle.dispose()
  })

  test("update() remounts through the same suite: top-swap ops + routing survives", async () => {
    const fake = fakeConnection()
    const [count, setCount] = createSignal(0)

    const handle = await render(
      (h) =>
        h(
          "div",
          { onClick: () => setCount((c) => c + 1) },
          () => `Count: ${count()}`,
        ),
      { connection: fake.connection as HelperConnection },
    )
    const mountMutations = fake.batches[0]!.mutations.length
    expect(mountMutations).toBeGreaterThan(0)

    // bun --hot style remount through the SAME renderer/connection.
    await handle.update((h) =>
      h(
        "div",
        { onClick: () => setCount((c) => c + 10) },
        () => `Count: ${count()}`,
      ),
    )

    const swapOps = fake.batches.slice(1).flatMap((b) => b.mutations.map((m) => m.op))
    expect(swapOps).toContain("destroyElement") // old subtree freed on the wire
    expect(swapOps).toContain("setRoot")

    // The NEW tree's onClick must be the one wired now. Ids continue the
    // suite's monotonic sequence: container=1, old div=2, old text=3,
    // new div=4, new text=5 — the click targets the new root div.
    fake.fireClick(4)
    await new Promise((r) => setTimeout(r, 20))
    expect(count()).toBe(10)

    await handle.dispose()
  })
})

test("onKeyDown handler receives key + modifiers payload", async () => {
  const fake = fakeConnection()
  let got: SolidGpuiEvent | undefined
  const handle = await render(
    (h) =>
      h(
        "div",
        {
          style: { display: "flex" },
          onKeyDown: (event: SolidGpuiEvent) => {
            got = event
          },
        },
        "k",
      ),
    { connection: fake.connection as HelperConnection },
  )

  const mountOps = fake.batches[0]!.mutations.map((m) => m.op)
  expect(mountOps).toContain("setEventListener")
  fake.fireKey(2)

  // Handler ran synchronously inside the event callback.
  expect(got).toEqual({
    type: "event",
    id: 2,
    eventType: "keyDown",
    key: "Enter",
    modifiers: { ctrl: true, alt: false, shift: false, cmd: false },
  })

  await handle.dispose()
})
