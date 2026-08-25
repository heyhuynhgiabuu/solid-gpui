/** Shorthand expansion unit tests (pure function, P1-d + r1 M3). */
import { describe, expect, test } from "bun:test"
import { expandShorthands } from "./style-normalize"

describe("expandShorthands", () => {
  test("numeric shorthand applies to all four sides", () => {
    expect(expandShorthands({ padding: 8 })).toEqual({
      paddingTop: 8,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
    })
  })

  test("string TRBL forms: 1, 2, 3, 4 values", () => {
    expect(expandShorthands({ padding: "10px" })).toEqual({
      paddingTop: "10px",
      paddingRight: "10px",
      paddingBottom: "10px",
      paddingLeft: "10px",
    })
    expect(expandShorthands({ padding: "10px 18px" })).toEqual({
      paddingTop: "10px",
      paddingRight: "18px",
      paddingBottom: "10px",
      paddingLeft: "18px",
    })
    expect(expandShorthands({ margin: "1 2 3" })).toEqual({
      marginTop: "1",
      marginRight: "2",
      marginBottom: "3",
      marginLeft: "2",
    })
    expect(expandShorthands({ inset: "1px 2px 3px 4px" })).toEqual({
      top: "1px",
      right: "2px",
      bottom: "3px",
      left: "4px",
    })
  })

  test("X/Y pick horizontal/vertical sides correctly", () => {
    expect(expandShorthands({ paddingX: 4, paddingY: 9 })).toEqual({
      paddingLeft: 4,
      paddingRight: 4,
      paddingTop: 9,
      paddingBottom: 9,
    })
    // X from a 4-value expansion: left takes sides[3], right sides[1].
    expect(expandShorthands({ paddingX: "1px 2px 3px 4px" })).toEqual({
      paddingLeft: "4px",
      paddingRight: "2px",
    })
  })

  test("size applies one value to both axes", () => {
    expect(expandShorthands({ size: 100 })).toEqual({ width: 100, height: 100 })
  })

  test("junk strings pass through unchanged (open-value rule)", () => {
    expect(expandShorthands({ padding: "0 auto" })).toEqual({ padding: "0 auto" })
    expect(expandShorthands({ margin: "loose" })).toEqual({ margin: "loose" })
  })

  test("unknown keys pass through; later physical keys win over earlier shorthand", () => {
    expect(expandShorthands({ cursor: "pointer" })).toEqual({ cursor: "pointer" })
    expect(expandShorthands({ padding: 4, paddingLeft: 9 })).toEqual({
      paddingTop: 4,
      paddingRight: 4,
      paddingBottom: 4,
      paddingLeft: 9,
    })
  })
})
