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

/**
 * Closed set of style-STATE layers: the helper must know every state to wire
 * gpui interactivity (same asymmetry as EVENT_TYPES — style KEYS stay open).
 */
export type StyleState = "hover" | "active" | "dragOver"

export const STYLE_STATES: readonly StyleState[] = ["hover", "active", "dragOver"]

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
]

export const ELEMENT_TYPES: readonly ElementType[] = [
  "div",
  "text",
  "input",
  "textarea",
  "list",
  "markdown",
  "scrollbar",
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
  | { readonly op: "setValue"; readonly id: ElementId; readonly value: string }
  | {
      readonly op: "setKeyBindings"
      readonly id: ElementId
      /** Keystroke strings; spaces separate a sequence ("ctrl-x ctrl-s"). */
      readonly bindings: readonly string[]
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
  "setKeyBindings",
  "setDragData",
  "setValue",
  "setAnimation",
  "setEventListener",
  "setRoot",
] as const

export type MutationOp = (typeof MUTATION_OPS)[number]
