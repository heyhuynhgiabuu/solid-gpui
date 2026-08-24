import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import fixture from "../../protocol/fixtures/batch-01.json"
import { spawnHelper } from "./index"
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

  test("close() resolves and helper exits 0 on stdin EOF", async () => {
    if (skip()) return
    const helper = spawnHelper({ binary })
    await helper.sendBatch(await fixtureBatch())
    await helper.close()
    const exit = await helper.exited
    expect(exit.code).toBe(0)
  })
})
