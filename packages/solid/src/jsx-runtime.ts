/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * TypeScript's JSX import-source entry for the Solid GPUI renderer.
 *
 * Solid 2's compiler still owns JSX lowering: applications use
 * `jsx: "preserve"`, `jsxImportSource: "@solid-gpui/solid"`, and the
 * universal `@solidjs/babel-plugin`. This entry owns the type namespace; it is
 * not an alternative automatic JSX factory, which would evaluate Solid
 * accessors eagerly and lose fine-grained tracking.
 */
import type { Element as SolidElement } from "solid-js"
import type {
  AccessibilityState,
  AnchorKind,
  DrawItem,
  EasingName,
  EventType,
  JsonValue,
  SolidGpuiEvent,
  StyleMap,
  TextRun,
} from "@solid-gpui/protocol"
import type { HostNode } from "./renderer"

/** A decoded event routed to an element handler, narrowed by event type. */
export type GpuiElementEvent<K extends EventType = EventType> =
  Omit<Extract<SolidGpuiEvent, { readonly type: "event" }>, "eventType"> & {
    readonly eventType: K
  }

/** Event callback shape used by JSX props and `keys` bindings. */
export type GpuiEventHandler<K extends EventType = EventType> = (
  event: GpuiElementEvent<K>,
) => void

/** Shortcut map accepted by the renderer's `keys` prop. */
export type GpuiKeyBindings = Readonly<Record<string, GpuiEventHandler<"keys">>>

export namespace JSX {
  /** Values that can be returned by a Solid GPUI component. */
  export type Element =
    | SolidElement
    | HostNode
    | ArrayElement
    | string
    | number
    | boolean
    | null
    | undefined

  export interface ArrayElement extends Array<Element> {}

  export interface ElementChildrenAttribute {
    children: {}
  }

  export interface ElementClass {}
  export interface ElementAttributesProperty {}

  export type Event<K extends EventType = EventType> = GpuiElementEvent<K>
  export type EventHandler<K extends EventType = EventType> = GpuiEventHandler<K>
  export type KeyBindings = GpuiKeyBindings

  interface CommonElementProps {
    readonly children?: Element
    readonly style?: StyleMap
    readonly deferred?: boolean
    readonly anchor?: AnchorKind | null
  }

  interface InteractiveElementProps extends CommonElementProps {
    /** Tailwind-compatible SUBSET utility classes; compiled to style/state
     * layers with diagnostics for anything outside the matrix
     * (docs/tailwind-subset.md). Static string only — dynamic classes should
     * recompute the StyleMap instead. */
    readonly class?: string
    readonly hoverStyle?: StyleMap
    readonly activeStyle?: StyleMap
    readonly dragOverStyle?: StyleMap
    readonly tooltip?: string | null
    readonly transitionMs?: number
    readonly transitionEasing?: EasingName
    readonly accessibility?: AccessibilityState | null
    readonly dragData?: JsonValue
    readonly keys?: KeyBindings
    readonly onClick?: EventHandler<"click">
    readonly onMouseDown?: EventHandler<"mouseDown">
    readonly onMouseUp?: EventHandler<"mouseUp">
    readonly onMouseEnter?: EventHandler<"mouseEnter">
    readonly onMouseLeave?: EventHandler<"mouseLeave">
    readonly onKeyDown?: EventHandler<"keyDown">
    readonly onKeyUp?: EventHandler<"keyUp">
    readonly onFocus?: EventHandler<"focus">
    readonly onBlur?: EventHandler<"blur">
    readonly onScroll?: EventHandler<"scroll">
    readonly onDragStart?: EventHandler<"dragStart">
    readonly onDrop?: EventHandler<"drop">
    /** Fires when a pointer press lands outside this element's rendered
     * bounds (helper-side detection; overlay dismissal). */
    readonly onOutsideClick?: EventHandler<"outsideClick">
    readonly onInput?: EventHandler<"input">
    readonly onChange?: EventHandler<"change">
    readonly onSubmit?: EventHandler<"submit">
  }

  interface InputElementProps extends InteractiveElementProps {
    readonly children?: never
    readonly value?: string
    readonly placeholder?: string
    readonly minRows?: number
    readonly maxRows?: number
  }

  interface TextareaElementProps extends InputElementProps {}

  interface ListElementProps extends InteractiveElementProps {}
  interface ScrollbarElementProps extends InteractiveElementProps {}

  interface TextElementProps extends CommonElementProps {
    readonly children?: never
    readonly runs?: readonly TextRun[]
  }

  interface MarkdownElementProps extends CommonElementProps {
    readonly children?: never
    readonly source?: string
  }

  interface CanvasElementProps extends CommonElementProps {
    readonly children?: never
    readonly drawList?: readonly DrawItem[]
  }

  interface SvgElementProps extends CommonElementProps {
    readonly children?: never
    readonly src?: string
  }

  interface ImgElementProps extends CommonElementProps {
    readonly children?: never
    readonly src?: string
  }

  /**
   * Lowercase tags not mapped to a special host element are generic GPUI divs.
   * Their props are still closed: unsupported browser props such as
   * `className` must not disappear silently at the renderer boundary.
   */
  type GenericElementProps = InteractiveElementProps

  export interface IntrinsicElements {
    [tag: string]: GenericElementProps
    div: GenericElementProps
    text: TextElementProps
    input: InputElementProps
    textarea: TextareaElementProps
    list: ListElementProps
    scrollbar: ScrollbarElementProps
    markdown: MarkdownElementProps
    canvas: CanvasElementProps
    svg: SvgElementProps
    img: ImgElementProps
  }
}
