import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import fixture from "../../protocol/fixtures/batch-01.json"
import { spawnHelper, HelperExitedError, ReplyError } from "./index"
import { decodeBatch } from "@solid-gpui/protocol"

const binary = resolve(import.meta.dir, "../../../target/debug/solid-gpui-helper")

function skip(): boolean {
  if (process.env.SOLID_GPUI_SKIP_HELPER_TESTS !== undefined) return true
  if (!existsSync(binary)) {
    console.warn(`helper binary missing at ${binary} — run cargo build -p solid-gpui-helper`)
    return true
  }
  return false
}

async function fixtureBatch() {
  const r = decodeBatch(JSON.stringify(fixture))
  if (!r.ok) throw new Error("fixture must decode")
  return r.value
}

describe("spawnHelper (real helper over stdio)", () => {
  test("batch is acked with seq and applied count", async () => {
    if (skip()) return
    const helper = spawnHelper({ binary })
    const ack = await helper.sendBatch(await fixtureBatch())
    expect(ack).toEqual({ seq: 42, applied: 12 })
    await helper.close()
    expect(await helper.exited).toEqual({ code: 0, signal: null })
  })

  test("sendBatch rejects after the helper died", async () => {
    if (skip()) return
    const helper = spawnHelper({ binary })
    helper.kill()
    await helper.exited
    await expect(helper.sendBatch(await fixtureBatch())).rejects.toThrow(/exited|closed/i)
  })

  test("in-flight send rejects when the helper is killed mid-await", async () => {
    if (skip()) return
    const helper = spawnHelper({ binary })
    const pending = helper.sendBatch(await fixtureBatch())
    helper.kill()
    await expect(pending).rejects.toThrow(HelperExitedError)
    await helper.exited
  })

  test("close() resolves and helper exits 0 on stdin EOF", async () => {
    if (skip()) return
    const helper = spawnHelper({ binary })
    await helper.sendBatch(await fixtureBatch())
    await helper.close()
    const exit = await helper.exited
    expect(exit.code).toBe(0)
  })
})

describe("spawn failure supervision", () => {
  test("nonexistent binary surfaces HelperExitedError, not a crash or hang", async () => {
    // Contract (Bun 1.4 + Node 24): spawn failure surfaces as HelperExitedError
    // — either thrown synchronously from spawnHelper (older Bun) or via the
    // async 'error' event: exited settles with {code:null,signal:null,error},
    // pending sends reject. Never an unhandled-'error' crash; never a hang.
    let conn: ReturnType<typeof spawnHelper> | null = null
    let thrown: unknown
    try {
      conn = spawnHelper({ binary: "/nonexistent/solid-gpui-helper" })
    } catch (e) {
      thrown = e
    }
    if (thrown) {
      expect(thrown).toBeInstanceOf(HelperExitedError)
      return
    }
    if (!conn) throw new Error("unreachable")
    const exit = await conn.exited
    expect(exit.code).toBeNull()
    expect(exit.signal).toBeNull()
    expect(typeof exit.error).toBe("string")
    await expect(conn.sendBatch({ v: 1, seq: 1, mutations: [] })).rejects.toBeInstanceOf(
      HelperExitedError,
    )
  })
})

describe("window mode (real rendering)", () => {
  test("getStats reports helper and protocol versions (Gate 5-a)", async () => {
    if (skip() || process.env.SOLID_GPUI_SKIP_GUI_TESTS !== undefined) return
    const helper = spawnHelper({ binary, mode: "window" })
    try {
      const value = (await helper.sendCommand({ type: "getStats", seq: 1 })) as Record<
        string,
        unknown
      >
      expect(typeof value.helperVersion).toBe("string")
      expect(value.helperVersion as string).toMatch(/^\d+\.\d+\.\d+/)
      expect(value.protocolVersion).toBe(1)
    } finally {
      await helper.close()
    }
  })

  test("fixture applies through the retained tree; apply errors are correlated", async () => {
    if (skip() || process.env.SOLID_GPUI_SKIP_GUI_TESTS !== undefined) return
    const helper = spawnHelper({ binary, mode: "window" })
    const ack = await helper.sendBatch(await fixtureBatch())
    expect(ack).toEqual({ seq: 42, applied: 12 })

    // Decodes fine, but parent 99 does not exist → ReplyError with the seq.
    await expect(
      helper.sendBatch({
        v: 1,
        seq: 7,
        mutations: [
          { op: "appendChild", parentId: 99 as never, childId: 1 as never },
        ],
      }),
    ).rejects.toBeInstanceOf(ReplyError)

    await helper.close()
    expect((await helper.exited).code).toBe(0)
  })
})
describe("duplicate seq guard", () => {
  test("second sendBatch with an in-flight seq rejects, first still settles", async () => {
    if (skip()) return
    const helper = spawnHelper({ binary })
    const batch = await fixtureBatch()
    const first = helper.sendBatch(batch)
    await expect(helper.sendBatch(batch)).rejects.toThrow(/seq.*already/i)
    await first // still acked normally
    await helper.close()
  })
})

describe("wire safety through the real helper (transport mode)", () => {
  test("version-mismatch batch rejects with decodeFailed (seq-less routing)", async () => {
    if (skip()) return
    const helper = spawnHelper({ binary })
    // Deliberate protocol violation: v=2 is not expressible in the MutationBatch
    // type, so the cast marks the test's intent to probe the wire boundary.
    const err = await helper
      .sendBatch({ v: 2, seq: 3, mutations: [] } as never)
      .then(
        () => null,
        (e) => e,
      )
    expect(err).toBeInstanceOf(ReplyError)
    expect((err as ReplyError).code).toBe("decodeFailed")
    expect((err as ReplyError).message).toContain("version")
    // The helper survived the bad line and still closes cleanly.
    await helper.close()
    expect((await helper.exited).code).toBe(0)
  })

  test("valid batch after the mismatch is still acked (helper not poisoned)", async () => {
    if (skip()) return
    const helper = spawnHelper({ binary })
    await expect(
      helper.sendBatch({ v: 2, seq: 3, mutations: [] } as never),
    ).rejects.toThrow(ReplyError)
    const ack = await helper.sendBatch(await fixtureBatch())
    expect(ack).toEqual({ seq: 42, applied: 12 })
    await helper.close()
  })


  test("transport-mode command rejects with a seq-correlated unsupported error", async () => {
    if (skip()) return
    const helper = spawnHelper({ binary })
    const err = await helper
      .sendCommand({ type: "getStats", seq: 9 })
      .then(
        () => null,
        (e) => e,
      )
    expect(err).toBeInstanceOf(ReplyError)
    expect((err as ReplyError).code).toBe("unsupported")
    expect((err as ReplyError).message).toMatch(/getStats/)
    await helper.close()
    expect((await helper.exited).code).toBe(0)
  })
})
