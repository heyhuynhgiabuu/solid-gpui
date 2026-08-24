/**
 * Visual demo: open the helper window and render the shared fixture batch.
 * Run: bun run demo  (window stays ~6s, then closes cleanly)
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

const helper = spawnHelper({ mode: "window" })
const ack = await helper.sendBatch(decoded.value)
console.log("rendered batch:", JSON.stringify(ack))

await new Promise((r) => setTimeout(r, 6000))
await helper.close()
console.log("window closed cleanly:", JSON.stringify(await helper.exited))
