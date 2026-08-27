import type { ElementId } from "./ids"
import type { StyleMap } from "./style"

/** Host element kinds understood by the helper in protocol v1. */
export type ElementType =
  | "div"
  | "text"
  | "input"
  | "textarea"
  | "list"
  | "markdown"
  | "scrollbar"
  /** Recorded draw list element (P8): rect/path/text ops, replaced
   * wholesale via setDrawList; no children, no interactive props. */
  | "canvas"
  /** Monochrome icon; the `text` IS raw SVG markup; tinted via the
   * `color` style key. No children, no interactive props. */
  | "svg"
  /** Raster image from a file path or http(s) URI (`src` prop).
   * No children, no interactive props. */
  | "img"

/**
 * Closed set: the helper must know an event to wire it, so unknown event
 * types are a decode error (unlike style keys, which are forward-compatible).
 */
export type EventType =
  | "click"
  /** Per-edit input notification (DOM onInput semantics). */
  | "input"
  | "mouseDown"
  | "mouseUp"
  | "mouseEnter"
  | "mouseLeave"
  | "keyDown"
  | "keyUp"
  | "focus"
  | "blur"
  | "scroll"
  | "change"
  | "submit"
  /** A `keys` binding fired; the event's key field carries the binding. */
  | "keys"
  /** A drag started on this element; value carries the JSON payload. */
  | "dragStart"
  /** A drag released over this target; value carries the JSON payload. */
  | "drop"
  /** A pointer press landed outside the subscribed element's rendered
   * bounds; carries the press position (Gate 3-a overlay dismissal). */
  | "outsideClick"

/**
 * Closed set of style-STATE layers: the helper must know every state to wire
 * gpui interactivity (same asymmetry as EVENT_TYPES — style KEYS stay open).
 */
/** Which corner of an anchored element pins to its render location (P10). */
export type AnchorKind =
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "bottomRight"
  | "topCenter"
  | "bottomCenter"
  | "leftCenter"
  | "rightCenter"

export const ANCHOR_KINDS: readonly AnchorKind[] = [
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
  "topCenter",
  "bottomCenter",
  "leftCenter",
  "rightCenter",
]

/** Roles supported by the host accessibility bridge for composite controls. */
export type AccessibilityRole = "combobox" | "listbox" | "option"

export const ACCESSIBILITY_ROLES: readonly AccessibilityRole[] = [
  "combobox",
  "listbox",
  "option",
]

/** Typed accessibility state applied atomically to one host element. */
export interface AccessibilityState {
  readonly role: AccessibilityRole
  readonly value?: string
  readonly expanded?: boolean
  readonly selected?: boolean
}

/** One recorded draw op in a canvas draw list (P8). Coordinates are
 * absolute px within the canvas bounds; replaced wholesale on each set. */
export type DrawItem =
  | {
      readonly type: "rect"
      readonly x: number
      readonly y: number
      readonly w: number
      readonly h: number
      readonly color: string
      readonly cornerRadius?: number
    }
  | {
      readonly type: "path"
      /** Flat vertex pairs [x, y, x, y, ...]. */
      readonly points: readonly number[]
      readonly color: string
      readonly strokeWidth?: number
      readonly closed?: boolean
    }
  | {
      readonly type: "text"
      readonly x: number
      readonly y: number
      readonly text: string
      readonly size: number
      readonly color: string
    }

export type StyleState = "hover" | "active" | "dragOver"

export const STYLE_STATES: readonly StyleState[] = ["hover", "active", "dragOver"]

/** One substring in a text element's wholesale styled-runs value (P11).
 * `text` keeps the wire independent of JavaScript's UTF-16 offsets; the
 * helper derives the UTF-8 byte lengths required by gpui. */
export type TextRunStyle = "normal" | "italic" | "oblique"

export interface TextRun {
  readonly text: string
  readonly color?: string
  readonly weight?: number
  readonly style?: TextRunStyle
  readonly underline?: boolean
}

export const EVENT_TYPES: readonly EventType[] = [
  "click",
  "input",
  "mouseDown",
  "mouseUp",
  "mouseEnter",
  "mouseLeave",
  "keyDown",
  "keyUp",
  "focus",
  "blur",
  "scroll",
  "change",
  "submit",
  "keys",
  "dragStart",
  "drop",
  "outsideClick",
]

export const ELEMENT_TYPES: readonly ElementType[] = [
  "div",
  "text",
  "input",
  "textarea",
  "list",
  "markdown",
  "scrollbar",
  "canvas",
  "svg",
  "img",
]

export type Mutation =
  | { readonly op: "createElement"; readonly id: ElementId; readonly elementType: ElementType }
  | { readonly op: "destroyElement"; readonly id: ElementId }
  | { readonly op: "appendChild"; readonly parentId: ElementId; readonly childId: ElementId }
  | { readonly op: "removeChild"; readonly parentId: ElementId; readonly childId: ElementId }
  | { readonly op: "insertBefore"; readonly parentId: ElementId; readonly childId: ElementId; readonly beforeId: ElementId }
  | {
      readonly op: "setStyle"
      readonly id: ElementId
      readonly style: StyleMap
      /** Interaction layer ("hover" | "active") — omitted = base style.
       * Closed set like eventType: the helper must know every state. */
      readonly state?: StyleState
    }
  | { readonly op: "setText"; readonly id: ElementId; readonly text: string }
  | { readonly op: "setTextRuns"; readonly id: ElementId; readonly runs: readonly TextRun[] }
  | { readonly op: "setValue"; readonly id: ElementId; readonly value: string }
  | { readonly op: "setTooltip"; readonly id: ElementId; readonly tooltip: string | null }
  | {
      readonly op: "setAccessibility"
      readonly id: ElementId
      readonly accessibility: AccessibilityState | null
    }
  | {
      readonly op: "setKeyBindings"
      readonly id: ElementId
      /** Keystroke strings; spaces separate a sequence ("ctrl-x ctrl-s"). */
      readonly bindings: readonly string[]
    }
  | {
      readonly op: "setSrc"
      readonly id: ElementId
      /** Absolute file path or http(s) URI. img-only. */
      readonly src: string
    }
  | {
      readonly op: "setDeferred"
      readonly id: ElementId
      /** Paint this element after all non-deferred ancestors. */
      readonly deferred: boolean
    }
  | {
      readonly op: "setAnchored"
      readonly id: ElementId
      /** Corner pinning the element to its render location; null clears. */
      readonly anchor: AnchorKind | null
    }
  | {
      readonly op: "setDrawList"
      readonly id: ElementId
      /** Recorded draw ops; replaces the previous list wholesale. */
      readonly items: readonly DrawItem[]
    }
  | {
      readonly op: "setDragData"
      readonly id: ElementId
      /** JSON payload string; empty clears drag-source behavior. */
      readonly data: string
    }
  | {
      readonly op: "setAnimation"
      readonly id: ElementId
      readonly target: { readonly [k in AnimatableStyleKey]?: number }
      readonly transitionMs: number
      readonly easing?: EasingName
    }
  | { readonly op: "setEventListener"; readonly id: ElementId; readonly eventType: EventType; readonly enabled: boolean }
  | { readonly op: "setRoot"; readonly id: ElementId }

/**
 * Closed set of style keys setAnimation may target (interpolation needs a
 * numeric render path on the helper). Unlike setStyle's open set, animating
 * an unsupported key is a decode error.
 */
export const ANIMATABLE_STYLE_KEYS = [
  "width",
  "height",
  "minWidth",
  "minHeight",
  // padding/paddingX/paddingY expand to physical keys BEFORE animation
  // detection, so the wire only ever carries these four.
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "gap",
  "borderRadius",
  "fontSize",
  "flexGrow",
  "flexShrink",
  "opacity",
] as const

export type AnimatableStyleKey = (typeof ANIMATABLE_STYLE_KEYS)[number]

export const EASING_NAMES = ["linear", "easeIn", "easeOut", "easeInOut"] as const

export type EasingName = (typeof EASING_NAMES)[number]

export const MUTATION_OPS = [
  "createElement",
  "destroyElement",
  "appendChild",
  "removeChild",
  "insertBefore",
  "setStyle",
  "setText",
  "setTextRuns",
  "setKeyBindings",
  "setSrc",
  "setDeferred",
  "setAnchored",
  "setDrawList",
  "setDragData",
  "setValue",
  "setTooltip",
  "setAccessibility",
  "setAnimation",
  "setEventListener",
  "setRoot",
] as const

export type MutationOp = (typeof MUTATION_OPS)[number]
