/**
 * Gate 2 Tailwind-subset compiler contract. parseUtilities maps APPROVED
 * utility classes onto the typed style surface the helper actually applies
 * (verified against crates/helper/src/host.rs) and reports every token it
 * refused so the renderer can warn honestly instead of dropping silently.
 */
import { describe, expect, test } from "bun:test"
import { parseUtilities } from "./utilities"

describe("parseUtilities — spacing scale", () => {
  test("4px-per-unit scale covers padding/margin/size families", () => {
    expect(parseUtilities("p-4").styles).toEqual({ padding: 16 })
    expect(parseUtilities("px-2 py-3").styles).toEqual({ paddingX: 8, paddingY: 12 })
    expect(parseUtilities("pt-1 pr-2 pb-3 pl-4").styles).toEqual({
      paddingTop: 4,
      paddingRight: 8,
      paddingBottom: 12,
      paddingLeft: 16,
    })
    expect(parseUtilities("m-0").styles).toEqual({ margin: 0 })
    expect(parseUtilities("mt-2 mb-2").styles).toEqual({ marginTop: 8, marginBottom: 8 })
    expect(parseUtilities("w-64 h-32").styles).toEqual({ width: 256, height: 128 })
    expect(parseUtilities("min-w-0 min-h-0").styles).toEqual({ minWidth: 0, minHeight: 0 })
    expect(parseUtilities("size-6").styles).toEqual({ size: 24 })
    expect(parseUtilities("gap-3").styles).toEqual({ gap: 12 })
  })

  test("negative margins are supported (Tailwind semantics); other families refuse the minus", () => {
    expect(parseUtilities("-mt-2 -mx-1").styles).toEqual({ marginTop: -8, marginX: -4 })
    expect(parseUtilities("-m-4").styles).toEqual({ margin: -16 })
    const refused = parseUtilities("-p-4 -w-8 -gap-2")
    expect(refused.styles).toEqual({})
    expect([...refused.unknown].sort()).toEqual(["-gap-2", "-p-4", "-w-8"])
  })

  test("negative margins are supported", () => {
    expect(parseUtilities("-mt-2").styles).toEqual({ marginTop: -8 })
  })

  test("arbitrary bracket lengths accept px/rem/% and plain numbers", () => {
    expect(parseUtilities("p-[10px]").styles).toEqual({ padding: 10 })
    expect(parseUtilities("p-[0.5rem]").styles).toEqual({ padding: 8 })
    expect(parseUtilities("w-[50%]").styles).toEqual({ width: "50%" })
    expect(parseUtilities("gap-[7px]").styles).toEqual({ gap: 7 })
  })

  test("fractional and bare-number utilities stay numeric px", () => {
    expect(parseUtilities("p-0.5").styles).toEqual({ padding: 2 })
    expect(parseUtilities("p-px").styles).toEqual({ padding: 1 })
  })
})

describe("parseUtilities — colors", () => {
  test("default palette shades map to exact Tailwind hexes", () => {
    expect(parseUtilities("bg-red-500 text-blue-500").styles).toEqual({
      backgroundColor: "#ef4444",
      color: "#3b82f6",
    })
    expect(parseUtilities("bg-slate-900 border-rose-400").unknown).toContain("border-rose-400")
    expect(parseUtilities("bg-emerald-500").styles).toEqual({ backgroundColor: "#10b981" })
    expect(parseUtilities("text-zinc-50").styles).toEqual({ color: "#fafafa" })
  })

  test("white/black shorthand works for bg and text", () => {
    expect(parseUtilities("bg-white text-black").styles).toEqual({
      backgroundColor: "#ffffff",
      color: "#000000",
    })
  })

  test("arbitrary hex colors are accepted in brackets; 4-digit shorthand is refused", () => {
    expect(parseUtilities("bg-[#123456] text-[#abc] bg-[#12345678]").styles).toEqual({
      backgroundColor: "#12345678",
      color: "#aabbcc",
    })
    // #rgba shorthand: refusing beats silently dropping the alpha digit.
    expect(parseUtilities("bg-[#abcd]").unknown).toEqual(["bg-[#abcd]"])
  })

  test("unknown shades or hues land in unknown, never invented", () => {
    const r = parseUtilities("bg-red-501 bg-mauve-500")
    expect(r.unknown).toEqual(["bg-red-501", "bg-mauve-500"])
    expect(r.styles).toEqual({})
  })
})

describe("parseUtilities — typography, opacity, radius", () => {
  test("text size scale is numeric px", () => {
    expect(parseUtilities("text-sm").styles).toEqual({ fontSize: 14 })
    expect(parseUtilities("text-base").styles).toEqual({ fontSize: 16 })
    expect(parseUtilities("text-2xl").styles).toEqual({ fontSize: 24 })
  })

  test("font weight names map to numeric weights", () => {
    expect(parseUtilities("font-medium font-bold").styles).toEqual({ fontWeight: 700 })
  })

  test("opacity-N divides by 100", () => {
    expect(parseUtilities("opacity-50 opacity-100").styles).toEqual({ opacity: 1 })
  })

  test("rounded scale matches Tailwind radii (bare rounded = 4px, md = 6px)", () => {
    expect(parseUtilities("rounded").styles).toEqual({ borderRadius: 4 })
    expect(parseUtilities("rounded-md").styles).toEqual({ borderRadius: 6 })
    expect(parseUtilities("rounded rounded-md rounded-full").styles).toEqual({ borderRadius: 9999 })
  })

  test("arbitrary radius brackets work", () => {
    expect(parseUtilities("rounded-[9px]").styles).toEqual({ borderRadius: 9 })
  })
})

describe("parseUtilities — layout", () => {
  test("only the alignment values gpui applies are mapped", () => {
    expect(parseUtilities("flex flex-col items-center justify-center").styles).toEqual({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    })
    // row is the default; emitting flexDirection:"row" would be a lie that
    // silently no-ops helper-side.
    expect(parseUtilities("flex-row").styles).toEqual({})
    expect(parseUtilities("flex-row").unknown).toEqual([])
  })

  test("flex sizing utilities map to grow/shrink numbers", () => {
    expect(parseUtilities("flex-1").styles).toEqual({ flexGrow: 1, flexShrink: 1 })
    expect(parseUtilities("grow shrink-0").styles).toEqual({ flexGrow: 1, flexShrink: 0 })
  })

  test("cursor-pointer maps onto the cursor arm", () => {
    expect(parseUtilities("cursor-pointer").styles).toEqual({ cursor: "pointer" })
  })
})

describe("parseUtilities — diagnostics", () => {
  test("every refused token is reported once with no styles from it", () => {
    const r = parseUtilities("p-4 hover:pink-500 justify-between md:hidden grid")
    expect(r.styles).toEqual({ padding: 16 })
    expect([...r.unknown].sort()).toEqual(
      ["hover:pink-500", "justify-between", "md:hidden", "grid"].sort(),
    )
  })

  test("later duplicate utilities win like CSS source order", () => {
    expect(parseUtilities("p-2 p-4").styles).toEqual({ padding: 16 })
  })
})
