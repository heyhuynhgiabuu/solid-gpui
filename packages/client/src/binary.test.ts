/**
 * Helper binary resolution chain tests (S16): env override → dev target →
 * per-platform npm package, with actionable guidance when nothing resolves.
 */
import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { resolveHelperBinary } from "./binary"

const fakeDeps = (over: Partial<Parameters<typeof resolveHelperBinary>[0]> = {}) => ({
  env: {} as Record<string, string | undefined>,
  exists: (_p: string) => false,
  resolve: (_spec: string, _from: string) => {
    throw new Error("not found")
  },
  platform: "darwin",
  arch: "arm64",
  moduleDir: "/repo/packages/client/src",
  ...over,
})

describe("resolveHelperBinary", () => {
  test("SOLID_GPUI_HELPER env override wins over everything", () => {
    const r = resolveHelperBinary(
      fakeDeps({
        env: { SOLID_GPUI_HELPER: "/custom/helper" },
        exists: (p) => p === "/repo/target/debug/solid-gpui-helper",
      }),
    )
    expect(r).toEqual({ path: "/custom/helper", source: "env" })
  })

  test("production guard skips the dev target even when it exists (Gate 4)", () => {
    // A packaged app must never grab a stray monorepo debug build: the
    // launcher sets SOLID_GPUI_NO_DEV_FALLBACK=1 and the dev-target arm of
    // the chain disappears entirely.
    const existsPaths: string[] = []
    const r = resolveHelperBinary(
      fakeDeps({
        env: { SOLID_GPUI_NO_DEV_FALLBACK: "1" },
        exists: (p) => {
          existsPaths.push(p)
          return p === "/npm/@solid-gpui/helper-darwin-arm64/solid-gpui-helper"
        },
        resolve: (spec) =>
          spec === "@solid-gpui/helper-darwin-arm64/package.json"
            ? "/npm/@solid-gpui/helper-darwin-arm64/package.json"
            : (() => {
                throw new Error("not found")
              })(),
      }),
    )
    expect("source" in r && r.source).toBe("platform-package")
    expect(existsPaths.some((p) => p.includes("target/debug"))).toBe(false)
  })

  test("production guard error names the sidecar fix, not cargo", () => {
    try {
      resolveHelperBinary(fakeDeps({ env: { SOLID_GPUI_NO_DEV_FALLBACK: "1" } }))
      throw new Error("should have thrown")
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain("production")
      expect(msg).toContain("SOLID_GPUI_HELPER")
      expect(msg).not.toContain("cargo build")
    }
  })

  test("dev target/debug wins when present (monorepo dev flow, no npm needed)", () => {
    const r = resolveHelperBinary(
      fakeDeps({
        exists: (p) => p === "/repo/target/debug/solid-gpui-helper",
      }),
    )
    expect(r).toEqual({ path: "/repo/target/debug/solid-gpui-helper", source: "dev-target" })
  })

  test("Windows dev target resolves the .exe sibling (cargo emits a .exe there)", () => {
    const r = resolveHelperBinary(
      fakeDeps({
        platform: "win32",
        exists: (p) => p === "/repo/target/debug/solid-gpui-helper.exe",
      }),
    )
    expect(r).toEqual({ path: "/repo/target/debug/solid-gpui-helper.exe", source: "dev-target" })
  })

  test("Linux x64 maps to the helper-linux-x64 platform package", () => {
    const r = resolveHelperBinary(
      fakeDeps({
        platform: "linux",
        arch: "x64",
        resolve: (spec: string) => spec,
        exists: (p) => p.includes("@solid-gpui/helper-linux-x64") && p.endsWith("/solid-gpui-helper"),
      }),
    )
    expect(r.source).toBe("platform-package")
    if (r.source === "platform-package") {
      expect(r.path).toContain("@solid-gpui/helper-linux-x64")
    }
  })

  test("win32 x64 maps to the helper-windows-x64 package and its .exe bin", () => {
    const r = resolveHelperBinary(
      fakeDeps({
        platform: "win32",
        arch: "x64",
        resolve: (spec: string, from: string) => resolve(from, spec),
        exists: (p) => p.includes("@solid-gpui/helper-windows-x64") && p.endsWith("solid-gpui-helper.exe"),
      }),
    )
    expect(r.source).toBe("platform-package")
    if (r.source === "platform-package") {
      expect(r.path).toContain("@solid-gpui/helper-windows-x64")
      expect(r.path.endsWith("solid-gpui-helper.exe")).toBe(true)
    }
  })

  test("platform package is used when dev target is absent (end-user flow)", () => {
    const r = resolveHelperBinary(
      fakeDeps({
        exists: (p) => p === "/npm/@solid-gpui/helper-darwin-arm64/solid-gpui-helper",
        resolve: (spec, from) => {
          expect(spec).toBe("@solid-gpui/helper-darwin-arm64/package.json")
          expect(from).toBe("/repo/packages/client/src")
          return "/npm/@solid-gpui/helper-darwin-arm64/package.json"
        },
      }),
    )
    expect(r).toEqual({
      path: "/npm/@solid-gpui/helper-darwin-arm64/solid-gpui-helper",
      source: "platform-package",
    })
  })

  test("platform package resolution failure falls through to guidance error", () => {
    try {
      resolveHelperBinary(fakeDeps())
      throw new Error("should have thrown")
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain("solid-gpui helper binary not found")
      expect(msg).toContain("SOLID_GPUI_HELPER")
      expect(msg).toContain("cargo build -p solid-gpui-helper")
      expect(msg).toContain("darwin-arm64")
    }
  })

  test("unsupported platform (no prebuilt package) still allows env/dev flows", () => {
    const r = resolveHelperBinary(
      fakeDeps({
        platform: "linux",
        arch: "x64",
        env: { SOLID_GPUI_HELPER: "/built/from/source" },
      }),
    )
    expect(r).toEqual({ path: "/built/from/source", source: "env" })

    // linux x64 is a supported platform now; use a genuinely unsupported one
    // for the no-prebuilt-package guidance.
    const err = (() => {
      try {
        resolveHelperBinary(fakeDeps({ platform: "sunos", arch: "x64" }))
        return null
      } catch (e) {
        return e as Error
      }
    })()
    expect(err?.message).toContain("sunos-x64")
    expect(err?.message).toContain("no prebuilt helper")
  })
})
