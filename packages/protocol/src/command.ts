import type { ProtocolError, Result } from "./batch"

/**
 * JS→helper request that is NOT a mutation batch. The `type` field carries
 * the command name; the demuxer matches it against this closed set after the
 * reply and event decoders decline.
 */
/** Native macOS selectors a menu item can wire to (closed set). */
export type OsActionName = "cut" | "copy" | "paste" | "selectAll" | "undo" | "redo"

export const OS_ACTIONS: readonly OsActionName[] = [
  "cut",
  "copy",
  "paste",
  "selectAll",
  "undo",
  "redo",
]

/** One entry in an application menu (P9); tagged via `type` on the wire. */
export type MenuItemSpec =
  | {
      readonly type: "item"
      readonly label: string
      /** Stable identifier echoed to JS in the menu event. */
      readonly id: string
      /** Keystroke shown next to the label and bound globally. Ignored when
       * osAction is set — macOS wires its own system equivalent. */
      readonly keystroke?: string
      readonly disabled?: boolean
      readonly checked?: boolean
      /** Native selector: macOS performs it; no JS event fires for that pick. */
      readonly osAction?: OsActionName
    }
  | { readonly type: "separator" }
  | { readonly type: "submenu"; readonly name: string; readonly items: readonly MenuItemSpec[] }

/** One application menu; every setMenus replaces the bar wholesale. */
export type MenuSpec = {
  readonly name: string
  readonly items: readonly MenuItemSpec[]
}

export type SolidGpuiCommand =
  | { readonly type: "getStats"; readonly seq: number }
  | { readonly type: "captureFrame"; readonly seq: number; readonly path: string }
  | { readonly type: "scrollTo"; readonly seq: number; readonly id: number; readonly x: number; readonly y: number }
  | { readonly type: "getScrollOffset"; readonly seq: number; readonly id: number }
  | { readonly type: "focusElement"; readonly seq: number; readonly id: number }
  | { readonly type: "simulateInput"; readonly seq: number; readonly id: number; readonly text: string }
  | { readonly type: "simulateKey"; readonly seq: number; readonly key: string }
  | { readonly type: "simulateMouse"; readonly seq: number; readonly x: number; readonly y: number }
  | { readonly type: "resetTree"; readonly seq: number }
  | { readonly type: "dumpTree"; readonly seq: number }
  | {
      readonly type: "setTheme"
      readonly seq: number
      /** Partial semantic-token map; only present tokens change. Token names
       * are an open set: unknown tokens are accepted and ignored helper-side
       * so newer clients stay compatible with older helpers. */
      readonly tokens: Readonly<Record<string, string>>
    }
  | { readonly type: "listInfo"; readonly seq: number; readonly id: number }
  | {
      readonly type: "setMenus"
      readonly seq: number
      /** Replaces the whole application menu bar. */
      readonly menus: readonly MenuSpec[]
    }
  | { readonly type: "setTitle"; readonly seq: number; readonly title: string }
  | { readonly type: "windowAction"; readonly seq: number; readonly action: WindowActionName }
  | {
      readonly type: "dialogMessage"
      readonly seq: number
      readonly level: DialogLevel
      readonly message: string
      readonly detail?: string
      readonly answers: readonly string[]
    }
  | {
      readonly type: "dialogOpenFile"
      readonly seq: number
      readonly files?: boolean
      readonly directories?: boolean
      readonly multiple?: boolean
      readonly prompt?: string
    }
  | {
      readonly type: "dialogSaveFile"
      readonly seq: number
      readonly directory?: string
      readonly suggestedName?: string
    }
  | { readonly type: "shellRevealPath"; readonly seq: number; readonly path: string }
  | { readonly type: "shellOpenPath"; readonly seq: number; readonly path: string }
  | { readonly type: "scrollToItem"; readonly seq: number; readonly id: number; readonly index: number }

export type WindowActionName = "minimize" | "zoom" | "toggleFullscreen" | "activate"
export type DialogLevel = "info" | "warning" | "critical"
export const WINDOW_ACTIONS: readonly WindowActionName[] = ["minimize", "zoom", "toggleFullscreen", "activate"]
export const DIALOG_LEVELS: readonly DialogLevel[] = ["info", "warning", "critical"]

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v)

class FieldError extends Error {
  constructor(readonly field: string) {
    super(field)
  }
}

const isDict = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const shape = (path: string, message: string): ProtocolError => ({
  kind: "invalidShape",
  path,
  message,
})

/** Decode one command line. Recoverable failures are Result errors, never thrown. */
export function decodeCommand(json: string): Result<SolidGpuiCommand, ProtocolError> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    return {
      ok: false,
      error: { kind: "invalidJson", message: e instanceof Error ? e.message : String(e) },
    }
  }
  if (!isDict(parsed)) return { ok: false, error: shape("$", "expected an object") }

  const type = parsed.type
  const KNOWN = [
    "getStats",
    "captureFrame",
    "scrollTo",
    "getScrollOffset",
    "focusElement",
    "simulateInput",
    "simulateKey",
    "simulateMouse",
    "resetTree",
    "setTheme",
    "dumpTree",
    "listInfo",
    "setMenus",
    "setTitle",
    "windowAction",
    "dialogMessage",
    "dialogOpenFile",
    "dialogSaveFile",
    "shellRevealPath",
    "shellOpenPath",
    "scrollToItem",
  ]
  if (!KNOWN.includes(type as string)) {
    return {
      ok: false,
      error: shape("type", `unknown command ${JSON.stringify(type ?? null)}`),
    }
  }
  if (!isInt(parsed.seq) || parsed.seq < 0 || parsed.seq > 0xffff_ffff) {
    return { ok: false, error: shape("seq", "expected an integer in 0..=4294967295") }
  }

  if (type === "captureFrame") {
    if (typeof parsed.path !== "string" || parsed.path.length === 0) {
      return { ok: false, error: shape("path", "expected a non-empty string") }
    }
    return { ok: true, value: { type, seq: parsed.seq, path: parsed.path } }
  }
  if (type === "simulateKey") {
    const key = parsed.key
    if (typeof key !== "string" || key.length === 0) {
      return { ok: false, error: shape("key", "expected a non-empty keystroke string") }
    }
    return { ok: true, value: { type, seq: parsed.seq, key } }
  }
  if (type === "simulateMouse") {
    const x = parsed.x
    const y = parsed.y
    if (typeof x !== "number" || !Number.isFinite(x)) {
      return { ok: false, error: shape("x", "expected a finite number") }
    }
    if (typeof y !== "number" || !Number.isFinite(y)) {
      return { ok: false, error: shape("y", "expected a finite number") }
    }
    return { ok: true, value: { type, seq: parsed.seq, x, y } }
  }
  if (type === "dumpTree") {
    return { ok: true, value: { type: "dumpTree", seq: parsed.seq } }
  }
  if (type === "setTheme") {
    if (!isDict(parsed.tokens)) {
      return { ok: false, error: shape("tokens", "expected an object of token name → color string") }
    }
    for (const [name, value] of Object.entries(parsed.tokens)) {
      // Value SHAPE is checked here; color VALIDITY is the helper's apply-time
      // job (applyFailed) — TS decodeCommand is the parity/test mirror, the
      // live pipeline only encodes, so the two stages never disagree.
      if (typeof value !== "string" || value.length === 0) {
        return { ok: false, error: shape(`tokens.${name}`, "expected a non-empty color string") }
      }
    }
    return {
      ok: true,
      value: { type: "setTheme", seq: parsed.seq, tokens: parsed.tokens as Record<string, string> },
    }
  }
  if (type === "resetTree") {
    return { ok: true, value: { type, seq: parsed.seq } }
  }
  if (type === "simulateInput") {
    const id = parsed.id
    if (!isInt(id) || id < 1 || id > 0xffff_ffff) {
      return { ok: false, error: shape("id", "expected an integer in 1..=4294967295") }
    }
    const text = parsed.text
    if (typeof text !== "string") {
      return { ok: false, error: shape("text", "expected a string") }
    }
    return { ok: true, value: { type, seq: parsed.seq, id, text } }
  }
  if (type === "scrollTo" || type === "getScrollOffset") {
    // Locals first: typeof/isInt guards narrow plain bindings, not
    // property accesses on a Record<string, unknown>.
    const id = parsed.id
    const x = parsed.x
    const y = parsed.y
    const badId = !isInt(id) || (id as number) < 1 || (id as number) > 0xffff_ffff
    if (type === "scrollTo") {
      if (badId || typeof x !== "number" || typeof y !== "number") {
        return {
          ok: false,
          error: shape("id/x/y", "scrollTo needs integer id and numeric x/y"),
        }
      }
      // Literal type fields: `type` is `unknown` and TS cannot narrow it
      // across nested ifs (false-branch of a literal check on unknown stays
      // unknown), so spell the variant name out here.
      return { ok: true, value: { type: "scrollTo", seq: parsed.seq, id, x, y } }
    }
    if (badId) {
      return { ok: false, error: shape("id", "getScrollOffset needs an integer id") }
    }
    return { ok: true, value: { type: "getScrollOffset", seq: parsed.seq, id } }
  }
  if (type === "listInfo") {
    const id = parsed.id
    const badId = !isInt(id) || (id as number) < 1 || (id as number) > 0xffff_ffff
    if (badId) {
      return { ok: false, error: shape("id", "listInfo needs an integer id") }
    }
    return { ok: true, value: { type: "listInfo", seq: parsed.seq, id } }
  }
  if (type === "setMenus") {
    if (!Array.isArray(parsed.menus)) {
      return { ok: false, error: shape("menus", "expected an array") }
    }
    for (const item of parsed.menus) {
      const r = decodeMenuSpec(item)
      if (!r.ok) return r
    }
    return { ok: true, value: { type: "setMenus", seq: parsed.seq, menus: parsed.menus as never } }
  }
  if (type === "setTitle") {
    if (typeof parsed.title !== "string" || parsed.title.length === 0) {
      return { ok: false, error: shape("title", "expected a non-empty string") }
    }
    return { ok: true, value: { type: "setTitle", seq: parsed.seq, title: parsed.title } }
  }
  if (type === "windowAction") {
    if (typeof parsed.action !== "string" || !WINDOW_ACTIONS.includes(parsed.action as WindowActionName)) {
      return { ok: false, error: shape("action", "unknown window action") }
    }
    return { ok: true, value: { type: "windowAction", seq: parsed.seq, action: parsed.action as WindowActionName } }
  }
  if (type === "dialogMessage") {
    if (typeof parsed.level !== "string" || !DIALOG_LEVELS.includes(parsed.level as DialogLevel)) {
      return { ok: false, error: shape("level", "unknown dialog level") }
    }
    if (typeof parsed.message !== "string" || parsed.message.length === 0) {
      return { ok: false, error: shape("message", "expected a non-empty string") }
    }
    if (parsed.detail !== undefined && typeof parsed.detail !== "string") {
      return { ok: false, error: shape("detail", "expected a string") }
    }
    if (!Array.isArray(parsed.answers) || parsed.answers.length === 0 || parsed.answers.some((a: unknown) => typeof a !== "string" || a.length === 0)) {
      return { ok: false, error: shape("answers", "expected a non-empty string array") }
    }
    return {
      ok: true,
      value: {
        type: "dialogMessage",
        seq: parsed.seq,
        level: parsed.level as DialogLevel,
        message: parsed.message,
        ...(parsed.detail !== undefined ? { detail: parsed.detail } : {}),
        answers: parsed.answers as string[],
      },
    }
  }
  const optionalBool = (field: string): boolean | undefined => {
    const v = (parsed as Record<string, unknown>)[field]
    if (v === undefined) return undefined
    if (typeof v !== "boolean") throw new FieldError(field)
    return v
  }
  if (type === "dialogOpenFile") {
    try {
      return {
        ok: true,
        value: {
          type: "dialogOpenFile",
          seq: parsed.seq,
          ...(optionalBool("files") !== undefined ? { files: optionalBool("files") } : {}),
          ...(optionalBool("directories") !== undefined ? { directories: optionalBool("directories") } : {}),
          ...(optionalBool("multiple") !== undefined ? { multiple: optionalBool("multiple") } : {}),
          ...(typeof parsed.prompt === "string" ? { prompt: parsed.prompt } : {}),
        },
      }
    } catch (e) {
      if (e instanceof FieldError) return { ok: false, error: shape(e.field, "expected a boolean") }
      throw e
    }
  }
  if (type === "dialogSaveFile") {
    if (parsed.directory !== undefined && typeof parsed.directory !== "string") {
      return { ok: false, error: shape("directory", "expected a string") }
    }
    if (parsed.suggestedName !== undefined && typeof parsed.suggestedName !== "string") {
      return { ok: false, error: shape("suggestedName", "expected a string") }
    }
    return {
      ok: true,
      value: {
        type: "dialogSaveFile",
        seq: parsed.seq,
        ...(parsed.directory !== undefined ? { directory: parsed.directory } : {}),
        ...(parsed.suggestedName !== undefined ? { suggestedName: parsed.suggestedName } : {}),
      },
    }
  }
  if (type === "shellRevealPath" || type === "shellOpenPath") {
    if (typeof parsed.path !== "string" || parsed.path.length === 0) {
      return { ok: false, error: shape("path", "expected a non-empty string") }
    }
    return { ok: true, value: { type, seq: parsed.seq, path: parsed.path } as SolidGpuiCommand }
  }
  if (type === "scrollToItem") {
    const id = parsed.id
    const badId = !isInt(id) || (id as number) < 1 || (id as number) > 0xffff_ffff
    if (badId) return { ok: false, error: shape("id", "scrollToItem needs an integer id") }
    if (!isInt(parsed.index) || parsed.index < 0) {
      return { ok: false, error: shape("index", "expected a non-negative integer") }
    }
    return { ok: true, value: { type: "scrollToItem", seq: parsed.seq, id, index: parsed.index } }
  }
  if (type === "focusElement") {
    const id = parsed.id
    const badId = !isInt(id) || (id as number) < 1 || (id as number) > 0xffff_ffff
    if (badId) {
      return { ok: false, error: shape("id", "focusElement needs an integer id") }
    }
    return { ok: true, value: { type: "focusElement", seq: parsed.seq, id } }
  }
  // Fallthrough: every other known type returned above, so this is getStats.
  return { ok: true, value: { type: "getStats", seq: parsed.seq } }
}

/** Encode a command to one JSON line. Field order matches the Rust encoder's
 * canonical output so byte-level fixture comparisons hold on both sides. */
export function encodeCommand(command: SolidGpuiCommand): string {
  if (command.type === "captureFrame") {
    return JSON.stringify({
      type: "captureFrame",
      seq: command.seq,
      path: command.path,
    })
  }
  if (command.type === "scrollTo") {
    return JSON.stringify({
      type: "scrollTo",
      seq: command.seq,
      id: command.id,
      x: command.x,
      y: command.y,
    })
  }
  if (command.type === "getScrollOffset") {
    return JSON.stringify({
      type: "getScrollOffset",
      seq: command.seq,
      id: command.id,
    })
  }
  if (command.type === "focusElement") {
    return JSON.stringify({
      type: "focusElement",
      seq: command.seq,
      id: command.id,
    })
  }
  if (command.type === "simulateInput") {
    return JSON.stringify({
      type: "simulateInput",
      seq: command.seq,
      id: command.id,
      text: command.text,
    })
  }
  if (command.type === "resetTree") {
    return JSON.stringify({
      type: "resetTree",
      seq: command.seq,
    })
  }
  if (command.type === "dumpTree") {
    return JSON.stringify({ type: "dumpTree", seq: command.seq })
  }
  if (command.type === "setTheme") {
    return JSON.stringify({
      type: "setTheme",
      seq: command.seq,
      tokens: command.tokens,
    })
  }
  if (command.type === "simulateKey") {
    return JSON.stringify({
      type: "simulateKey",
      seq: command.seq,
      key: command.key,
    })
  }
  if (command.type === "simulateMouse") {
    return JSON.stringify({
      type: "simulateMouse",
      seq: command.seq,
      x: command.x,
      y: command.y,
    })
  }
  if (command.type === "listInfo") {
    return JSON.stringify({
      type: "listInfo",
      seq: command.seq,
      id: command.id,
    })
  }
  if (command.type === "setTitle") {
    return JSON.stringify({ type: "setTitle", seq: command.seq, title: command.title })
  }
  if (command.type === "windowAction") {
    return JSON.stringify({ type: "windowAction", seq: command.seq, action: command.action })
  }
  if (command.type === "dialogMessage") {
    return JSON.stringify({
      type: "dialogMessage",
      seq: command.seq,
      level: command.level,
      message: command.message,
      ...(command.detail !== undefined ? { detail: command.detail } : {}),
      answers: command.answers,
    })
  }
  if (command.type === "dialogOpenFile") {
    return JSON.stringify({
      type: "dialogOpenFile",
      seq: command.seq,
      ...(command.files !== undefined ? { files: command.files } : {}),
      ...(command.directories !== undefined ? { directories: command.directories } : {}),
      ...(command.multiple !== undefined ? { multiple: command.multiple } : {}),
      ...(command.prompt !== undefined ? { prompt: command.prompt } : {}),
    })
  }
  if (command.type === "dialogSaveFile") {
    return JSON.stringify({
      type: "dialogSaveFile",
      seq: command.seq,
      ...(command.directory !== undefined ? { directory: command.directory } : {}),
      ...(command.suggestedName !== undefined ? { suggestedName: command.suggestedName } : {}),
    })
  }
  if (command.type === "shellRevealPath" || command.type === "shellOpenPath") {
    return JSON.stringify({ type: command.type, seq: command.seq, path: command.path })
  }
  if (command.type === "scrollToItem") {
    return JSON.stringify({
      type: "scrollToItem",
      seq: command.seq,
      id: command.id,
      index: command.index,
    })
  }
  if (command.type === "setMenus") {
    // Field-order-exact: optionals only when present (mirrors Rust
    // skip_serializing_if), so byte-comparison fixtures stay possible.
    return JSON.stringify({
      type: "setMenus",
      seq: command.seq,
      menus: command.menus.map((menu) => ({
        name: menu.name,
        items: menu.items.map(wireMenuItem),
      })),
    })
  }
  return JSON.stringify({ type: "getStats", seq: command.seq })
}

function wireMenuItem(item: MenuItemSpec): unknown {
  if (item.type === "separator") return { type: "separator" }
  if (item.type === "submenu") {
    return { type: "submenu", name: item.name, items: item.items.map(wireMenuItem) }
  }
  return {
    type: "item",
    label: item.label,
    id: item.id,
    ...(item.keystroke !== undefined ? { keystroke: item.keystroke } : {}),
    ...(item.disabled !== undefined ? { disabled: item.disabled } : {}),
    ...(item.checked !== undefined ? { checked: item.checked } : {}),
    ...(item.osAction !== undefined ? { osAction: item.osAction } : {}),
  }
}

function decodeMenuItemSpec(item: unknown): Result<unknown, ProtocolError> {
  if (!isDict(item)) return { ok: false, error: shape("menus.items", "expected an object") }
  switch (item.type) {
    case "separator":
      return { ok: true, value: undefined }
    case "submenu": {
      if (typeof item.name !== "string" || !Array.isArray(item.items)) {
        return { ok: false, error: shape("menus.submenu", "needs string name and items array") }
      }
      for (const child of item.items) {
        const r = decodeMenuItemSpec(child)
        if (!r.ok) return r
      }
      return { ok: true, value: undefined }
    }
    case "item": {
      if (typeof item.label !== "string" || typeof item.id !== "string" || item.id.length === 0) {
        return { ok: false, error: shape("menus.item", "needs string label and non-empty id") }
      }
      if (item.keystroke !== undefined && typeof item.keystroke !== "string") {
        return { ok: false, error: shape("menus.item.keystroke", "expected a string") }
      }
      for (const flag of ["disabled", "checked"] as const) {
        if (item[flag] !== undefined && typeof item[flag] !== "boolean") {
          return { ok: false, error: shape(`menus.item.${flag}`, "expected a boolean") }
        }
      }
      if (item.osAction !== undefined && !OS_ACTIONS.includes(item.osAction as OsActionName)) {
        return { ok: false, error: shape("menus.item.osAction", `expected one of ${OS_ACTIONS.join("|")}`) }
      }
      return { ok: true, value: undefined }
    }
    default:
      return { ok: false, error: shape("menus.items.type", 'expected "item", "separator", or "submenu"') }
  }
}

function decodeMenuSpec(spec: unknown): Result<unknown, ProtocolError> {
  if (!isDict(spec)) return { ok: false, error: shape("menus", "expected an object") }
  if (typeof spec.name !== "string" || spec.name.length === 0) {
    return { ok: false, error: shape("menus.name", "expected a non-empty string") }
  }
  if (!Array.isArray(spec.items)) {
    return { ok: false, error: shape("menus.items", "expected an array") }
  }
  for (const item of spec.items) {
    const r = decodeMenuItemSpec(item)
    if (!r.ok) return r
  }
  return { ok: true, value: undefined }
}
