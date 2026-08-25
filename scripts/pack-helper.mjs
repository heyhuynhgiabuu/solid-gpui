#!/usr/bin/env node
/**
 * Assemble a per-platform helper npm package (ADR 005) from a built binary.
 *
 *   node scripts/pack-helper.mjs --target darwin-arm64 --binary target/release/solid-gpui-helper [--version 0.1.0] [--out dist/pack]
 *
 * Produces dist/pack/helper-<target>/ containing package.json, the binary,
 * and a README. `npm publish` that directory (platform packages go FIRST —
 * the packages that pin them via optionalDependencies must never install
 * against a missing binary).
 */
import { parseArgs } from "node:util"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    binary: { type: "string" },
    version: { type: "string" },
    out: { type: "string" },
  },
})

if (!values.target || !values.binary) {
  console.error("usage: pack-helper.mjs --target darwin-arm64 --binary <path> [--version 0.1.0] [--out dist/pack]")
  process.exit(2)
}

const target = values.target
const os = target.startsWith("darwin") ? "darwin" : target.split("-")[0]
const cpu = target.endsWith("arm64") ? "arm64" : "x64"
// Single-file Mach-O: the binary IS the payload; gzip saved <40% on a
// release build and cost us a runtime decompress step.
const version = values.version ?? "0.1.0"
const outDir = resolve(values.out ?? "dist/pack", `helper-${target}`)

const rootPkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
mkdirSync(outDir, { recursive: true })
copyFileSync(resolve(values.binary), resolve(outDir, "solid-gpui-helper"))

const pkg = {
  name: `@solid-gpui/helper-${target}`,
  version,
  description: `Prebuilt solid-gpui helper binary for ${target} (Rust + gpui host process)`,
  license: rootPkg.license,
  os: [os],
  cpu: [cpu],
  files: ["solid-gpui-helper"],
}
writeFileSync(resolve(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n")

writeFileSync(
  resolve(outDir, "README.md"),
  `# @solid-gpui/helper-${target}\n\nPrebuilt solid-gpui helper (${os}-${cpu}).\nInstalled automatically as an optionalDependency of @solid-gpui/client — you should not depend on this package directly.\n\nSee https://github.com/heyhuynhgiabuu/solid-gpui for the project.\n`,
)

console.log(`packed ${outDir} (version ${version}, ${os}-${cpu})`)
