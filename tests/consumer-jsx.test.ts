import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

describe("consumer JSX TypeScript surface", () => {
  test("external .tsx fixture typechecks against the renderer package", () => {
    const result = spawnSync("bun", ["run", "check:consumer-jsx"], {
      cwd: root,
      encoding: "utf8",
    })
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
    expect(result.status, output).toBe(0)
  })
})
