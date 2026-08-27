/**
 * Helper binary resolution (S16): env override → monorepo dev target →
 * per-platform npm package, then actionable guidance. Pure resolution —
 * spawnHelper stays the only spawner.
 */
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { createRequire } from "node:module"

/** Platform → npm package carrying the prebuilt helper (ADR 005). */
const PLATFORM_PACKAGES: Record<string, string> = {
  "darwin arm64": "@solid-gpui/helper-darwin-arm64",
  "darwin x64": "@solid-gpui/helper-darwin-x64",
}

/** Injected seams so tests can fake env/fs/resolution/platform. */
export interface ResolveDeps {
  env: Record<string, string | undefined>
  exists(path: string): boolean
  /** Node-style resolution: specifier + parent directory. */
  resolve(spec: string, from: string): string
  platform: string
  arch: string
  /** Directory of THIS module — the resolution parent for platform packages. */
  moduleDir: string
}

export type HelperResolution =
  | { path: string; source: "env" }
  | { path: string; source: "dev-target" }
  | { path: string; source: "platform-package" }

export function resolveHelperBinary(deps: ResolveDeps): HelperResolution {
  // 1. Explicit override always wins — the user knows better than any chain.
  const envPath = deps.env["SOLID_GPUI_HELPER"]
  if (envPath) return { path: envPath, source: "env" }

  // Production mode (Gate 4): a packaged app must never grab a stray
  // monorepo debug build. The launcher sets SOLID_GPUI_NO_DEV_FALLBACK=1 and
  // the dev-target arm disappears entirely; only env/platform-package remain.
  const production = deps.env["SOLID_GPUI_NO_DEV_FALLBACK"] === "1"

  // 2. Monorepo dev target: no npm packages needed while developing here.
  const devPath = resolve(deps.moduleDir, "../../../target/debug/solid-gpui-helper")
  if (!production && deps.exists(devPath)) return { path: devPath, source: "dev-target" }

  // 3. Prebuilt platform package (end users; optionalDependencies).
  const pkg = PLATFORM_PACKAGES[`${deps.platform} ${deps.arch}`]
  if (pkg) {
    try {
      const pkgJson = deps.resolve(`${pkg}/package.json`, deps.moduleDir)
      const bin = resolve(dirname(pkgJson), "solid-gpui-helper")
      if (deps.exists(bin)) return { path: bin, source: "platform-package" }
    } catch {
      // optionalDependencies may legitimately be absent (wrong-platform
      // install, --no-optional): fall through to guidance.
    }
  }

  const tried = production
    ? [
        `SOLID_GPUI_HELPER env override (REQUIRED in a production bundle: point it at the packaged solid-gpui-helper sidecar)`,
        pkg ? `${pkg} (optional dependency)` : `no prebuilt helper for ${deps.platform}-${deps.arch}`,
      ]
    : [
        `SOLID_GPUI_HELPER env override`,
        devPath,
        pkg ? `${pkg} (optional dependency)` : `no prebuilt helper for ${deps.platform}-${deps.arch}`,
      ]
  const fix = production
    ? `Fix: the launcher must set SOLID_GPUI_HELPER to the bundled helper before spawning (see docs/packaging.md).`
    : `Fix: set SOLID_GPUI_HELPER to a built binary, or run ` +
      `cargo build -p solid-gpui-helper from a checkout, or install the ` +
      `matching @solid-gpui/helper-* optional dependency.`
  throw new Error(
    `solid-gpui helper binary not found (platform ${deps.platform}-${deps.arch}, ` +
      `${production ? "production" : "development"} resolution). ` +
      `Tried, in order: ${tried.join("; ")}. ${fix}`,
  )
}

/** Production wiring for spawnHelper's default binary. */
export function defaultBinaryDeps(): ResolveDeps {
  return {
    env: process.env,
    exists: existsSync,
    resolve: (spec, from) => {
      const req = createRequire(resolve(from, "index.js"))
      return req.resolve(spec)
    },
    platform: process.platform,
    arch: process.arch,
    moduleDir: dirname(new URL(import.meta.url).pathname),
  }
}
