import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
// Same predicate scripts/consumer-h-smoke.ts applies: helper-less environments
// (the headless CI ts job has no cargo build) must skip, not fail the suite.
// The smoke itself runs for real wherever the binary exists (local dev, CI
// node-smoke job).
const helperPath =
  process.env.SOLID_GPUI_HELPER ?? resolve(root, "target/debug/solid-gpui-helper")

describe("consumer h() acceptance fixture", () => {
  test("external .ts fixture typechecks against the public renderer package", () => {
    const result = spawnSync("bun", ["run", "check:consumer-h"], {
      cwd: root,
      encoding: "utf8",
    })
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
    expect(result.status, output).toBe(0)
  })

  const runSmoke = existsSync(helperPath) ? test : test.skip
  runSmoke("fixture smoke crosses Bun and Node through the real helper", () => {
    const result = spawnSync("bun", ["run", "smoke:consumer-h"], {
      cwd: root,
      encoding: "utf8",
    })
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
    expect(result.status, output).toBe(0)
  })
})
