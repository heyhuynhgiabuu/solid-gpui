/**
 * The mock host must be protocol-faithful: it decodes through the SAME
 * @solid-gpui/protocol decoders the client uses and answers with the same
 * reply shapes as the real helper. This test drives it as a subprocess,
 * exactly the way a consumer's app would.
 */
import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const mockPath = resolve(root, "scripts/mock-host.mjs")

interface Session {
  send: (line: string) => Promise<Record<string, unknown>>
  close: () => Promise<number | null>
}

function spawnMock(): Session {
  const child = spawn(mockPath, ["--stdio"], { stdio: ["pipe", "pipe", "pipe"] })
  const pending: ((v: Record<string, unknown>) => void)[] = []
  const reader = require("node:readline").createInterface({ input: child.stdout! })
  reader.on("line", (line: string) => {
    const next = pending.shift()
    if (next) next(JSON.parse(line))
  })
  return {
    send: (line) =>
      new Promise((res) => {
        pending.push(res)
        child.stdin.write(`${line}\n`)
      }),
    close: () =>
      new Promise((res) => {
        child.stdin.end()
        child.on("exit", (code) => res(code))
      }),
  }
}

function fixtureLine(): string {
  // Smallest legal batch: v1 + seq + empty mutations (decode-checked).
  return JSON.stringify({ v: 1, seq: 7, mutations: [] })
}

describe("mock host (protocol-faithful, no Rust toolchain)", () => {
  test("acks a valid batch through the shared decoders", async () => {
    const session = spawnMock()
    const ack = await session.send(fixtureLine())
    expect(ack.type).toBe("ack")
    expect(ack.seq).toBe(7)
    expect(ack.applied).toBe(0)
    const code = await session.close()
    expect(code).toBe(0)
  })

  test("answers dumpTree with the mirror shape and getStats with versions", async () => {
    const session = spawnMock()
    // Mount a minimal tree: div 1 (root) with text child 2.
    await session.send(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [
          { op: "createElement", id: 1, elementType: "div" },
          { op: "createElement", id: 2, elementType: "text" },
          { op: "setRoot", id: 1 },
          { op: "appendChild", parentId: 1, childId: 2 },
          { op: "setText", id: 2, text: "hello mock" },
        ],
      }),
    )
    const dump = await session.send(JSON.stringify({ type: "dumpTree", seq: 2 }))
    expect(dump.type).toBe("result")
    const value = dump.value as { count: number; root: { id: number; children: { text: string }[] } }
    expect(value.count).toBe(2)
    expect(value.root.id).toBe(1)
    expect(value.root.children[0].text).toBe("hello mock")

    const stats = await session.send(JSON.stringify({ type: "getStats", seq: 3 }))
    const statsValue = stats.value as { helperVersion: string; protocolVersion: number; mock: boolean }
    expect(statsValue.mock).toBe(true)
    expect(statsValue.protocolVersion).toBe(1)
    await session.close()
  })

  test("rejects an invalid batch with decodeFailed (shared decoder)", async () => {
    const session = spawnMock()
    const reply = await session.send(JSON.stringify({ v: 1, seq: 8, mutations: [{ op: "nope" }] }))
    expect(reply.type).toBe("error")
    expect(reply.code).toBe("decodeFailed")
    await session.close()
  })

  test("SOLID_GPUI_MOCK_CLICK fires exactly once, not per batch", async () => {
    const child = spawn(mockPath, ["--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SOLID_GPUI_MOCK_CLICK: "2" },
    })
    const pending: ((v: Record<string, unknown>) => void)[] = []
    const events: Record<string, unknown>[] = []
    const reader = require("node:readline").createInterface({ input: child.stdout! })
    reader.on("line", (line: string) => {
      const msg = JSON.parse(line)
      if (msg.type === "event") events.push(msg)
      const next = pending.shift()
      if (next) next(msg)
    })
    const send = (line: string) =>
      new Promise<Record<string, unknown>>((res) => {
        pending.push(res)
        child.stdin.write(`${line}\n`)
      })
    // Register a click listener on node 2, then two more batches: the click
    // must fire exactly once, not once per batch (regression).
    await send(
      JSON.stringify({
        v: 1,
        seq: 1,
        mutations: [
          { op: "createElement", id: 2, elementType: "div" },
          { op: "setEventListener", id: 2, eventType: "click", enabled: true },
        ],
      }),
    )
    await send(JSON.stringify({ v: 1, seq: 2, mutations: [] }))
    await send(JSON.stringify({ v: 1, seq: 3, mutations: [] }))
    expect(events.length).toBe(1)
    child.stdin.end()
  })

  test("window commands answer unsupported like the real helper's transport mode", async () => {
    const session = spawnMock()
    const reply = await session.send(JSON.stringify({ type: "captureFrame", seq: 9, path: "/tmp/x.png" }))
    expect(reply.type).toBe("error")
    expect(reply.code).toBe("unsupported")
    await session.close()
  })
})
