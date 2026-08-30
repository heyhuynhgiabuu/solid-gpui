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
 * Run the Gate 0 h()/render() consumer fixture under Bun and Node.
 *
 * The default transport mode proves both host runtimes and the real helper's
 * mutation boundary without requiring a window server. Set
 * SOLID_GPUI_GATE0_GUI=1 to use --stdio-window and exercise the helper's
 * simulateInput event backchannel as well.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const harnessPath = resolve(root, "tests/consumer-h/harness.ts")

// Windows: cargo emits helper.exe; resolve the sibling before the pre-flight.
let helperPath = process.env.SOLID_GPUI_HELPER ?? resolve(root, "target/debug/solid-gpui-helper")
if (!existsSync(helperPath) && existsSync(`${helperPath}.exe`)) helperPath = `${helperPath}.exe`
if (!existsSync(helperPath)) {
  throw new Error(`helper binary is missing: ${helperPath}; run cargo build -p solid-gpui-helper`)
}
if (!existsSync(harnessPath)) throw new Error(`consumer harness is missing: ${harnessPath}`)

const env = { ...process.env, SOLID_GPUI_HELPER: helperPath }
run("bun", ["--conditions=browser", harnessPath], env)
run("node", ["--conditions=browser", "--import", "tsx", harnessPath], env)
console.log(
  process.env.SOLID_GPUI_GATE0_GUI === "1"
    ? "CONSUMER h() SMOKE OK — Bun and Node real-helper event/mutation path passed"
    : "CONSUMER h() SMOKE OK — Bun and Node crossed the real helper; native event injection is GUI-gated",
)

function run(command: string, args: readonly string[], childEnv: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd: root,
    env: childEnv,
    encoding: "utf8",
  })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}\n${output}`)
  }
  process.stdout.write(output)
}
