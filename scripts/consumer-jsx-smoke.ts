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
 * Compile one external-looking TSX module with the Solid universal plugin,
 * then run the same generated module under Bun and Node against the real
 * transport helper. The smoke intentionally uses transport mode so it proves
 * the host/runtime boundary without requiring a window server.
 */
import { transformSync } from "@babel/core"
import solidPlugin from "@solidjs/babel-plugin"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const fixturePath = resolve(root, "tests/consumer-jsx/runtime-fixture.tsx")
const helperPath = process.env.SOLID_GPUI_HELPER ?? resolve(root, "target/debug/solid-gpui-helper")

if (!existsSync(helperPath)) {
  throw new Error(`helper binary is missing: ${helperPath}; run cargo build -p solid-gpui-helper`)
}

const transformed = transformSync(readFileSync(fixturePath, "utf8"), {
  filename: fixturePath,
  plugins: [[solidPlugin, { moduleName: "@solid-gpui/solid/jsx", generate: "universal" }]],
  parserOpts: { plugins: ["jsx", "typescript"] },
})
const generated = transformed?.code
if (!generated) throw new Error("Solid Babel transform returned no generated module")

const tempRoot = resolve(root, ".pi/review-tmp")
mkdirSync(tempRoot, { recursive: true })
const tempDir = mkdtempSync(join(tempRoot, "consumer-jsx-"))
const generatedPath = join(tempDir, "fixture.mjs")
const harnessPath = join(tempDir, "harness.mjs")
writeFileSync(generatedPath, generated)
writeFileSync(
  harnessPath,
  `import { spawnHelper } from "@solid-gpui/client";
import { mountJsx } from "@solid-gpui/solid/jsx";
import { App, setLabel } from ${JSON.stringify(pathToFileURL(generatedPath).href)};

const connection = spawnHelper({ binary: ${JSON.stringify(helperPath)}, mode: "transport" });
const sent = [];
const sendBatch = connection.sendBatch.bind(connection);
connection.sendBatch = (batch) => {
  sent.push(batch);
  return sendBatch(batch);
};
let handle;
try {
  handle = await mountJsx(() => App(), { connection });
  if (handle.connection !== connection) throw new Error("mountJsx did not reuse the supplied connection");
  const initialCount = sent.length;
  if (initialCount === 0) throw new Error("compiled JSX produced no initial helper batch");

  setLabel("updated");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await handle.renderer.flush();
  const updateBatches = sent.slice(initialCount);
  const updateOps = updateBatches.flatMap((batch) => batch.mutations.map((mutation) => mutation.op));
  if (sent.length <= initialCount || !updateOps.includes("setText")) {
    throw new Error(JSON.stringify({ initialCount, sendCount: sent.length, updateOps }));
  }
  console.log(JSON.stringify({ initialCount, updateBatches: updateBatches.length, updateOps }));
} finally {
  if (handle) await handle.dispose();
  else await connection.close();
}
`,
)

try {
  run("bun", ["--conditions=browser", harnessPath])
  run("node", ["--conditions=browser", "--import", "tsx", harnessPath])
  console.log("CONSUMER JSX SMOKE OK — Bun and Node compiled JSX crossed the real helper")
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, SOLID_GPUI_HELPER: helperPath },
    encoding: "utf8",
  })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}\n${output}`)
  }
  process.stdout.write(output)
}
