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
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
const os = target.startsWith("darwin")
  ? "darwin"
  : target.startsWith("windows")
    ? "win32"
    : target.split("-")[0]
const cpu = target.endsWith("arm64") ? "arm64" : "x64"
// Whitelist: an unknown target must fail loudly, not silently publish a
// wrong-cpu package (a typo'd or future matrix row).
if (!/^(darwin|linux|windows)-(arm64|x64)$/.test(target)) {
  console.error(
    `pack-helper: unsupported target "${target}". Known: darwin-arm64, darwin-x64, linux-x64, windows-x64. ` +
      `Add the target to PLATFORM_PACKAGES-style whitelists deliberately (helper os/cpu here, client optionalDependencies, check-release).`,
  )
  process.exit(2)
}
// Windows: cargo emits helper.exe; the packaged bin name carries it.
const binName = target.startsWith("windows") ? "solid-gpui-helper.exe" : "solid-gpui-helper"
// Single-file Mach-O: the binary IS the payload; gzip saved <40% on a
// release build and cost us a runtime decompress step.
const version = values.version ?? "0.1.0"
const outDir = resolve(values.out ?? "dist/pack", `helper-${target}`)

const rootPkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
mkdirSync(outDir, { recursive: true })
copyFileSync(resolve(values.binary), resolve(outDir, binName))
// Gate 4: the packaged sidecar MUST be executable regardless of the source
// file's mode — a non-exec helper would only fail at first launch on a user
// machine (release.yml smokes the packaged binary to keep this honest).
chmodSync(resolve(outDir, binName), 0o755)

const pkg = {
  name: `@solid-gpui/helper-${target}`,
  version,
  description: `Prebuilt solid-gpui helper binary for ${target} (Rust + gpui host process)`,
  license: rootPkg.license,
  os: [os],
  cpu: [cpu],
  files: [binName],
}
writeFileSync(resolve(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n")

writeFileSync(
  resolve(outDir, "README.md"),
  `# @solid-gpui/helper-${target}\n\nPrebuilt solid-gpui helper (${os}-${cpu}).\nInstalled automatically as an optionalDependency of @solid-gpui/client — you should not depend on this package directly.\n\nSee https://github.com/heyhuynhgiabuu/solid-gpui for the project.\n`,
)

console.log(`packed ${outDir} (version ${version}, ${os}-${cpu})`)
