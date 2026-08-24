/**
 * Node-runtime compatibility smoke for @solid-gpui/client (Bun is the primary
 * dev runtime; Node support is a project requirement). Run: bun run smoke:node
 */
import { spawnHelper } from "../packages/client/src/index"
import { decodeBatch } from "@solid-gpui/protocol"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

const here = fileURLToPath(new URL(".", import.meta.url))
const fixture = readFileSync(
  resolve(here, "../packages/protocol/fixtures/batch-01.json"),
  "utf8",
)
const decoded = decodeBatch(fixture)
if (!decoded.ok) throw new Error(`fixture must decode: ${JSON.stringify(decoded.error)}`)

const helper = spawnHelper({})
const ack = await helper.sendBatch(decoded.value)
if (ack.seq !== 42 || ack.applied !== 12) {
  throw new Error(`unexpected ack: ${JSON.stringify(ack)}`)
}
await helper.close()
const exit = await helper.exited
if (exit.code !== 0) throw new Error(`helper exited ${exit.code}`)

console.log("NODE SMOKE OK — ack", JSON.stringify(ack), "exit", JSON.stringify(exit))
