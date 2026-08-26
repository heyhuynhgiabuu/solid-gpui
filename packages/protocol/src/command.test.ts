import { describe, expect, test } from "bun:test"
import getStatsFixture from "../fixtures/command-get-stats.json"
import captureFrameFixture from "../fixtures/command-capture-frame.json"
import scrollToFixture from "../fixtures/command-scroll-to.json"
import getScrollOffsetFixture from "../fixtures/command-get-scroll-offset.json"
import focusElementFixture from "../fixtures/command-focus-element.json"
import simulateInputFixture from "../fixtures/command-simulate-input.json"
import listInfoFixture from "../fixtures/command-list-info.json"
import { type SolidGpuiCommand, decodeCommand, encodeCommand } from "./command"

const ok = (json: string) => {
  const r = decodeCommand(json)
  if (!r.ok) throw new Error(`decode failed: ${JSON.stringify(r.error)}`)
  return r.value
}

describe("decodeCommand", () => {
  test("getStats fixture parses (Rust↔TS command parity)", () => {
    expect(ok(JSON.stringify(getStatsFixture))).toEqual({ type: "getStats", seq: 7 })
  })

  test("captureFrame fixture parses with path", () => {
    expect(ok(JSON.stringify(captureFrameFixture))).toEqual({
      type: "captureFrame",
      seq: 8,
      path: "/tmp/shot.png",
    })
  })

  test("encodeCommand emits canonical field order (fixture parity)", () => {
    expect(encodeCommand({ type: "getStats", seq: 7 })).toBe(
      JSON.stringify(getStatsFixture),
    )
    expect(
      encodeCommand({ type: "captureFrame", seq: 8, path: "/tmp/shot.png" }),
    ).toBe(JSON.stringify(captureFrameFixture))
  })

  test("scrollTo fixture parses and re-encodes exactly (parity)", () => {
    expect(ok(JSON.stringify(scrollToFixture))).toEqual({
      type: "scrollTo",
      seq: 9,
      id: 1,
      x: 0,
      y: 500,
    })
    expect(
      encodeCommand({ type: "scrollTo", seq: 9, id: 1, x: 0, y: 500 }),
    ).toBe(JSON.stringify(scrollToFixture))
  })

  test("getScrollOffset fixture parses and re-encodes exactly (parity)", () => {
    expect(ok(JSON.stringify(getScrollOffsetFixture))).toEqual({
      type: "getScrollOffset",
      seq: 10,
      id: 1,
    })
    expect(
      encodeCommand({ type: "getScrollOffset", seq: 10, id: 1 }),
    ).toBe(JSON.stringify(getScrollOffsetFixture))
  })

  test("focusElement fixture parses and re-encodes exactly (parity)", () => {
    expect(ok(JSON.stringify(focusElementFixture))).toEqual({
      type: "focusElement",
      seq: 12,
      id: 3,
    })
    expect(encodeCommand({ type: "focusElement", seq: 12, id: 3 })).toBe(
      JSON.stringify(focusElementFixture),
    )
  })

  test("scrollTo without id is invalidShape", () => {
    const r = decodeCommand(JSON.stringify({ type: "scrollTo", seq: 9, x: 0, y: 500 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })

  test("simulateInput fixture parses and re-encodes exactly (parity)", () => {
    // The fixture is emitted by Rust command_to_json; both suites must agree.
    const parsed = decodeCommand(JSON.stringify(simulateInputFixture))
    expect(parsed).toEqual({
      ok: true,
      value: { type: "simulateInput", seq: 44, id: 7, text: "ab" },
    })
    const enc = encodeCommand(
      (parsed as { value: Parameters<typeof encodeCommand>[0] }).value,
    )
    expect(enc).toBe(JSON.stringify(simulateInputFixture))
  })

  test("listInfo fixture parses and re-encodes exactly (parity)", () => {
    const parsed = decodeCommand(JSON.stringify(listInfoFixture))
    expect(parsed).toEqual({ ok: true, value: { type: "listInfo", seq: 33, id: 4 } })
    expect(
      encodeCommand((parsed as { value: Parameters<typeof encodeCommand>[0] }).value),
    ).toBe(JSON.stringify(listInfoFixture))
  })

  test("encodeCommand emits simulateInput correctly (not getStats)", () => {
    // Regression: encodeCommand used to fall through to the getStats branch.
    const json = encodeCommand({ type: "simulateInput", seq: 44, id: 7, text: "ab" })
    expect(json).toBe('{"type":"simulateInput","seq":44,"id":7,"text":"ab"}')
  })

  test("simulateInput decodes id + text", () => {
    const r = decodeCommand(
      JSON.stringify({ type: "simulateInput", seq: 44, id: 7, text: "ab" }),
    )
    expect(r).toEqual({ ok: true, value: { type: "simulateInput", seq: 44, id: 7, text: "ab" } })
  })

  test("simulateInput rejects non-string text", () => {
    const r = decodeCommand(JSON.stringify({ type: "simulateInput", seq: 44, id: 7, text: 3 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })

  test("unknown command name is invalidShape (closed set)", () => {
    const r = decodeCommand(JSON.stringify({ type: "teleport", seq: 1 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe("invalidShape")
  })
})

describe("P4 command encode (review r1 Blocker)", () => {
  const cases: SolidGpuiCommand[] = [
    { type: "setTitle", seq: 1, title: "Notes" },
    { type: "windowAction", seq: 2, action: "toggleFullscreen" },
    { type: "dialogMessage", seq: 3, level: "warning", message: "m", detail: "d", answers: ["a", "b"] },
    { type: "dialogOpenFile", seq: 4, files: true, directories: true, multiple: true, prompt: "pick" },
    { type: "dialogSaveFile", seq: 5, directory: "/tmp", suggestedName: "notes.md" },
    { type: "shellRevealPath", seq: 6, path: "/x" },
    { type: "shellOpenPath", seq: 7, path: "/y" },
  ]
  test.each?.(cases) ?? void 0
  for (const c of cases) {
    test(`encodeCommand keeps type ${c.type} (no getStats fallthrough)`, () => {
      const wire = encodeCommand(c)
      expect(wire).toContain(`"type":"${c.type}"`)
      expect(wire).not.toContain('"type":"getStats"')
      // Round-trip through the validator pins shape + optional-field omissions.
      const r = decodeCommand(wire)
      expect(r.ok).toBe(true)
    })
  }
  test("dialogSaveFile carries suggestedName on the wire", () => {
    const wire = encodeCommand({ type: "dialogSaveFile", seq: 5, suggestedName: "notes.md" })
    expect(wire).toContain('"suggestedName":"notes.md"')
  })
})

describe("scrollToItem (P5)", () => {
  test("encode keeps the type — no getStats fallthrough — and decodes back", () => {
    const wire = encodeCommand({ type: "scrollToItem", seq: 42, id: 7, index: 12 })
    expect(wire).toBe('{"type":"scrollToItem","seq":42,"id":7,"index":12}')
    const r = decodeCommand(wire)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ type: "scrollToItem", seq: 42, id: 7, index: 12 })
  })
  test("decode rejects invalid ids and negative indexes", () => {
    const badId = decodeCommand('{"type":"scrollToItem","seq":1,"id":0,"index":0}')
    expect(badId.ok).toBe(false)
    const badIx = decodeCommand('{"type":"scrollToItem","seq":1,"id":1,"index":-3}')
    expect(badIx.ok).toBe(false)
  })
})

describe("setMenus (P9)", () => {
  test("decode accepts the full spec surface and rejects malformed specs", () => {
    const ok = decodeCommand(
      JSON.stringify({
        type: "setMenus",
        seq: 5,
        menus: [
          {
            name: "File",
            items: [
              { type: "item", label: "Open…", id: "file.open", keystroke: "cmd-o" },
              { type: "separator" },
              { type: "item", label: "Copy", id: "edit.copy", osAction: "copy", checked: true },
              { type: "submenu", name: "Export", items: [{ type: "item", label: "PDF", id: "export.pdf" }] },
            ],
          },
        ],
      }),
    )
    expect(ok.ok).toBe(true)

    const bad = [
      { type: "setMenus", seq: 1, menus: "nope" },
      { type: "setMenus", seq: 1, menus: [{ name: "", items: [] }] },
      { type: "setMenus", seq: 1, menus: [{ name: "m", items: [{ type: "blob" }] }] },
      { type: "setMenus", seq: 1, menus: [{ name: "m", items: [{ type: "item", label: "L", id: "" }] }] },
      { type: "setMenus", seq: 1, menus: [{ name: "m", items: [{ type: "item", label: "L", id: "x", osAction: "quit" }] }] },
    ]
    for (const b of bad) expect(decodeCommand(JSON.stringify(b)).ok).toBe(false)
  })

  test("encode round-trips through decode with optionals exact (real encoder)", () => {
    // The P4 lesson: exercise encodeCommand itself, not JSON.stringify of
    // the caller's object.
    const encoded = encodeCommand({
      type: "setMenus",
      seq: 9,
      menus: [
        {
          name: "Edit",
          items: [
            { type: "item", label: "Copy", id: "edit.copy", keystroke: "cmd-c", osAction: "copy" },
            { type: "separator" },
            { type: "submenu", name: "More", items: [{ type: "separator" }] },
          ],
        },
      ],
    })
    const r = decodeCommand(encoded)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.type).toBe("setMenus")
      if (r.value.type === "setMenus") {
        expect(r.value.menus[0]?.items[0]).toMatchObject({
          type: "item",
          label: "Copy",
          id: "edit.copy",
          keystroke: "cmd-c",
          osAction: "copy",
        })
        expect(r.value.menus[0]?.items[0]).not.toHaveProperty("disabled")
        expect(r.value.menus[0]?.items[2]?.type).toBe("submenu")
      }
    }
  })
})
