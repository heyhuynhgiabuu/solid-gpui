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

import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const marker = "HEADLESS_GPUI_BENCHMARK "
const child = Bun.spawn(
  [
    "cargo",
    "test",
    "--color",
    "never",
    "-p",
    "solid-gpui-helper",
    "headless_render_benchmark",
    "--",
    "--ignored",
    "--nocapture",
  ],
  {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  },
)

const [stdout, stderr] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
])
const exitCode = await child.exited
if (exitCode !== 0) {
  process.stderr.write(stdout)
  process.stderr.write(stderr)
  process.exit(exitCode)
}

const reports = stdout
  .split("\n")
  .map((line) => line.trimStart())
  .filter((line) => line.startsWith(marker))
if (reports.length !== 1) {
  throw new Error(
    `headless GPUI benchmark emitted ${reports.length} reports; expected exactly one`,
  )
}

const report = JSON.parse(reports[0].slice(marker.length)) as unknown
if (
  typeof report !== "object" ||
  report === null ||
  !("schema" in report) ||
  report.schema !== "solid-gpui-gpui-benchmark/v1"
) {
  throw new Error("headless GPUI benchmark emitted an unexpected report schema")
}
console.log(JSON.stringify(report, null, 2))
