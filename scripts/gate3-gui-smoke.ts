/*
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
 * Run the Gate 3 GUI overlay evidence harness (real window, real input
 * dispatch). Opt-in via SOLID_GPUI_GATE3_GUI=1 because it needs a window
 * server and a built helper; plain invocation prints a skip note and exits 0
 * so headless CI can wire it without failing.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const harnessPath = resolve(root, "tests/gate3-gui/overlay-harness.ts")

if (process.env.SOLID_GPUI_GATE3_GUI !== "1") {
  console.log("GATE3 GUI SMOKE SKIPPED — set SOLID_GPUI_GATE3_GUI=1 with a window server to run it")
  process.exit(0)
}
// Windows: cargo emits helper.exe; resolve the sibling before the pre-flight.
let helperPath = process.env.SOLID_GPUI_HELPER ?? resolve(root, "target/debug/solid-gpui-helper")
if (!existsSync(helperPath) && existsSync(`${helperPath}.exe`)) helperPath = `${helperPath}.exe`
if (!existsSync(helperPath)) {
  throw new Error(`helper binary is missing: ${helperPath}; run cargo build -p solid-gpui-helper`)
}
if (!existsSync(harnessPath)) throw new Error(`gate3 harness is missing: ${harnessPath}`)

const env = { ...process.env, SOLID_GPUI_HELPER: helperPath }
const result = spawnSync(
  "bun",
  [
    "--conditions=browser",
    "--preload",
    "./scripts/solid-jsx-preload.ts",
    harnessPath,
  ],
  { cwd: root, env, encoding: "utf8", timeout: 120_000 },
)
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
if (result.error) throw result.error
process.stdout.write(output)
if (result.status !== 0) {
  throw new Error(`gate3 gui harness failed with ${result.status}`)
}
