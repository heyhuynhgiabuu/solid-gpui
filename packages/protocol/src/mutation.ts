import type { ElementId } from "./ids"
import type { StyleMap } from "./style"

/** Host element kinds understood by the helper in protocol v1. */
export type ElementType = "div" | "text"

/**
 * Closed set: the helper must know an event to wire it, so unknown event
 * types are a decode error (unlike style keys, which are forward-compatible).
 */
export type EventType =
  | "click"
  | "mouseDown"
  | "mouseUp"
  | "mouseEnter"
  | "mouseLeave"
  | "keyDown"
  | "keyUp"
  | "focus"
  | "blur"
  | "scroll"

export const EVENT_TYPES: readonly EventType[] = [
  "click",
  "mouseDown",
  "mouseUp",
  "mouseEnter",
  "mouseLeave",
  "keyDown",
  "keyUp",
  "focus",
  "blur",
  "scroll",
]

export const ELEMENT_TYPES: readonly ElementType[] = ["div", "text"]

export type Mutation =
  | { readonly op: "createElement"; readonly id: ElementId; readonly elementType: ElementType }
  | { readonly op: "destroyElement"; readonly id: ElementId }
  | { readonly op: "appendChild"; readonly parentId: ElementId; readonly childId: ElementId }
  | { readonly op: "removeChild"; readonly parentId: ElementId; readonly childId: ElementId }
  | { readonly op: "insertBefore"; readonly parentId: ElementId; readonly childId: ElementId; readonly beforeId: ElementId }
  | { readonly op: "setStyle"; readonly id: ElementId; readonly style: StyleMap }
  | { readonly op: "setText"; readonly id: ElementId; readonly text: string }
  | { readonly op: "setEventListener"; readonly id: ElementId; readonly eventType: EventType; readonly enabled: boolean }
  | { readonly op: "setRoot"; readonly id: ElementId }

export const MUTATION_OPS = [
  "createElement",
  "destroyElement",
  "appendChild",
  "removeChild",
  "insertBefore",
  "setStyle",
  "setText",
  "setEventListener",
  "setRoot",
] as const

export type MutationOp = (typeof MUTATION_OPS)[number]
