#!/usr/bin/env node
/**
 * Release consistency check: every published package carries the SAME
 * version, and @solid-gpui/client's optionalDependencies pin the helper
 * packages at exactly that version. A drift would publish a graph where a
 * client installs a helper it cannot resolve (or a mismatched protocol).
 *
 *   node scripts/check-release.mjs [--expect 0.1.0]   # CI: assert equality
 *   node scripts/check-release.mjs --tag v0.1.0       # also match the tag
 *
 * Exits non-zero with a report on any mismatch.
 */
import { parseArgs } from "node:util"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const parsed = parseArgs({
  options: { expect: { type: "string" }, tag: { type: "string" } },
})

const root = new URL("..", import.meta.url).pathname
const pkgs = ["protocol", "client", "solid"].map((p) => {
  const json = JSON.parse(readFileSync(resolve(root, `packages/${p}/package.json`), "utf8"))
  return { name: json.name, version: json.version, optionalDependencies: json.optionalDependencies, json }
})

const client = pkgs.find((p) => p.name === "@solid-gpui/client")
const helperPin = client?.optionalDependencies ?? {}
const problems = []

const versions = new Set(pkgs.map((p) => p.version))
const expected = parsed.values.expect ?? parsed.values.tag?.replace(/^v/, "") ?? null

for (const p of pkgs) {
  if (expected && p.version !== expected) {
    problems.push(`${p.name} is ${p.version}, expected ${expected}`)
  }
}
if (versions.size > 1) {
  problems.push(`versions drift across packages: ${pkgs.map((p) => `${p.name}@${p.version}`).join(", ")}`)
}

const helperTargets = ["@solid-gpui/helper-darwin-arm64", "@solid-gpui/helper-darwin-x64"]
for (const target of helperTargets) {
  const pin = helperPin[target]
  if (!pin) {
    problems.push(`client does not pin ${target} in optionalDependencies`)
  } else if (pin !== client?.version) {
    problems.push(`client pins ${target}@${pin} but client itself is ${client.version}`)
  }
}

if (problems.length > 0) {
  console.error("release check FAILED:")
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`release check OK: ${pkgs.map((p) => `${p.name}@${p.version}`).join(", ")} + helper pins ${helperTargets.join(", ")} @ ${client.version}`)
