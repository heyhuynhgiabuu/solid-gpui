#!/usr/bin/env node
/**
 * Pack a TS package for publishing (ADR 005): stage package.json + dist +
 * LICENSE (+ README if present) into dist/pack/<name>/, rewriting the
 * exports map to the built dist files, then `npm pack` there.
 *
 * Why staging: in-repo exports point at ./src/*.ts (bun tests consume
 * source directly); the published manifest must point at ./dist. Doing the
 * rewrite here keeps publish behavior explicit instead of relying on
 * publishConfig semantics (which npm does not apply to `npm pack`).
 *
 *   node scripts/pack-package.mjs packages/solid [--out dist/pack]
 */
import { parseArgs } from "node:util"
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const parsed = parseArgs({
  options: { out: { type: "string" }, version: { type: "string" } },
  allowPositionals: true,
})

const pkgDir = parsed.positionals?.[0]
if (!pkgDir || !existsSync(resolve(pkgDir, "package.json"))) {
  console.error("usage: pack-package.mjs <package-dir> [--out dist/pack]")
  process.exit(2)
}

const src = resolve(pkgDir)
const pkg = JSON.parse(readFileSync(resolve(src, "package.json"), "utf8"))
const outRoot = resolve(parsed.values.out ?? "dist/pack")
const stage = resolve(outRoot, pkg.name.replace(/^@/, "").replace(/\//, "-"))
// Start from a clean stage every run: stale trees from earlier invocations
// (and cp-into-existing-dir nesting) must never leak into a tarball.
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

copyFileSync(resolve(src, "package.json"), resolve(stage, "package.json"))
copyFileSync(resolve(src, "LICENSE"), resolve(stage, "LICENSE"))
if (existsSync(resolve(src, "README.md"))) copyFileSync(resolve(src, "README.md"), resolve(stage, "README.md"))
// cpSync (not shell cp): BSD cp -R nests the source dir into an existing
// destination under BOTH the "dir" and "dir/." spellings — verified live.
// Node's cpSync with a fresh destination is deterministic everywhere.
cpSync(resolve(src, "dist"), resolve(stage, "dist"), { recursive: true })

// Rewrite resolution to built output (entries mirror the src exports map).
const published = { ...pkg }
delete published.scripts
delete published.devDependencies
published.files = ["dist"]
// workspace:* ranges are meaningless outside the monorepo: pin them to
// this package's version (lockstep releases keep the graph coherent).
const pin = parsed.values.version ?? pkg.version
for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  const deps = published[field]
  if (!deps) continue
  published[field] = Object.fromEntries(
    Object.entries(deps).map(([name, range]) => [
      name,
      String(range).startsWith("workspace:") ? pin : range,
    ]),
  )
}
const distExports = {}
for (const [key, _target] of Object.entries(pkg.exports ?? { ".": null })) {
  const base = key === "." ? "index" : key.replace(/^\.\//, "")
  distExports[key] = {
    types: `./dist/${base}.d.mts`,
    default: `./dist/${base}.mjs`,
  }
}
published.exports = distExports
writeFileSync(resolve(stage, "package.json"), JSON.stringify(published, null, 2) + "\n")

execFileSync("npm", ["pack", "-q", "--pack-destination", resolve(outRoot)], { cwd: stage, stdio: "inherit" })
console.log(`packed ${pkg.name} from ${stage}`)
