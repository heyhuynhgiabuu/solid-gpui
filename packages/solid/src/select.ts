import { createContext, createEffect, createSignal, onCleanup, useContext } from "solid-js"
import type { Element as SolidElement } from "solid-js"
import type {
  AccessibilityState,
  SolidGpuiEvent,
  StyleMap,
} from "@solid-gpui/protocol"
import {
  createComponent,
  createElement,
  effect,
  insert,
  setProp,
  Show,
} from "./jsx"
import type { HostNode } from "./renderer"

type SelectMode = "select" | "combobox"

type SelectChildren = SolidElement | (() => SelectChildren)

export interface SelectRootProps {
  /** Controlled selected/input value. */
  readonly value: string
  /** Called when a selectable item or combobox edit requests a new value. */
  readonly onValueChange: (value: string) => void
  /** Initial open state; open state remains internal after mount. */
  readonly defaultOpen?: boolean
  /** Observes internal open/close transitions. */
  readonly onOpenChange?: (open: boolean) => void
  readonly style?: StyleMap
  readonly children?: SelectChildren
}

export interface SelectTriggerProps {
  readonly style?: StyleMap
  readonly children?: SelectChildren
}

export interface ComboboxTriggerProps {
  readonly style?: StyleMap
  readonly placeholder?: string
}

export interface SelectContentProps {
  readonly style?: StyleMap
  readonly children?: SelectChildren
}

export interface SelectItemProps {
  readonly value: string
  readonly label?: string
  readonly disabled?: boolean
  readonly style?: StyleMap
  readonly children?: SelectChildren
}

interface RegisteredItem {
  readonly token: symbol
  readonly value: string
  readonly disabled: boolean
}

interface SelectContext {
  readonly mode: SelectMode
  readonly value: () => string
  readonly open: () => boolean
  readonly items: () => readonly RegisteredItem[]
  readonly toggle: () => void
  readonly openMenu: () => void
  readonly closeMenu: () => void
  readonly handleKey: (event: SolidGpuiEvent) => void
  readonly inputValue: (value: string) => void
  readonly selectValue: (value: string) => void
  readonly selectActive: () => void
  readonly moveActive: (direction: 1 | -1) => void
  readonly moveToEdge: (edge: "first" | "last") => void
  readonly activeIndex: () => number | null
  readonly register: (item: Omit<RegisteredItem, "token">) => () => void
}

const SelectContext = createContext<SelectContext>()

function context(): SelectContext {
  const value = useContext(SelectContext)
  if (!value) {
    throw new Error("[solid-gpui] select primitives must be nested under select.Root or combobox.Root")
  }
  return value
}

function firstEnabled(items: readonly RegisteredItem[]): number | null {
  const index = items.findIndex((item) => !item.disabled)
  return index >= 0 ? index : null
}

function lastEnabled(items: readonly RegisteredItem[]): number | null {
  for (let index = items.length - 1; index >= 0; index--) {
    if (!items[index]?.disabled) return index
  }
  return null
}

function selectedIndex(items: readonly RegisteredItem[], value: string): number | null {
  const index = items.findIndex((item) => item.value === value && !item.disabled)
  return index >= 0 ? index : null
}

function nextEnabled(
  items: readonly RegisteredItem[],
  current: number | null,
  direction: 1 | -1,
): number | null {
  if (items.length === 0) return null
  const start = current ?? (direction === 1 ? -1 : items.length)
  for (let step = 1; step <= items.length; step++) {
    const index = (start + direction * step + items.length) % items.length
    if (!items[index]?.disabled) return index
  }
  return null
}

function reactiveProp<T>(node: HostNode, name: string, read: () => T): void {
  effect(read, (value: T) => {
    setProp(node, name, value)
  })
}

function applyStyle(node: HostNode, style: StyleMap | undefined): void {
  if (style) setProp(node, "style", style)
}

function accessibility(
  role: AccessibilityState["role"],
  value: string | undefined,
  expanded: boolean | undefined,
  selected: boolean | undefined,
): AccessibilityState {
  return {
    role,
    ...(value === undefined ? {} : { value }),
    ...(expanded === undefined ? {} : { expanded }),
    ...(selected === undefined ? {} : { selected }),
  }
}

function createContextValue(props: SelectRootProps, mode: SelectMode): SelectContext {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)
  const [items, setItems] = createSignal<readonly RegisteredItem[]>([])
  const [activeIndex, setActiveIndex] = createSignal<number | null>(null)

  const closeMenu = (): void => {
    if (!open()) return
    setOpen(false)
    setActiveIndex(null)
    props.onOpenChange?.(false)
  }

  const openMenu = (): void => {
    if (open()) return
    setOpen(true)
    props.onOpenChange?.(true)
  }

  const selectValue = (value: string): void => {
    const item = items().find((candidate) => candidate.value === value)
    if (item?.disabled) return
    try {
      props.onValueChange(value)
    } finally {
      closeMenu()
    }
  }

  const selectActive = (): void => {
    const index = activeIndex()
    const item = index === null ? undefined : items()[index]
    if (item) selectValue(item.value)
  }

  const moveActive = (direction: 1 | -1): void => {
    const list = items()
    const current = activeIndex() ?? selectedIndex(list, props.value)
    setActiveIndex(nextEnabled(list, current, direction))
  }

  const moveToEdge = (edge: "first" | "last"): void => {
    setActiveIndex(edge === "first" ? firstEnabled(items()) : lastEnabled(items()))
  }

  const toggle = (): void => {
    if (open()) closeMenu()
    else openMenu()
  }

  const inputValue = (value: string): void => {
    props.onValueChange(value)
    openMenu()
  }

  const handleKey = (event: SolidGpuiEvent): void => {
    if (event.type !== "event" || event.eventType !== "keyDown") return
    const key = event.key?.toLowerCase() ?? ""
    switch (key) {
      case "arrowdown":
      case "down":
        if (open()) moveActive(1)
        else openMenu()
        break
      case "arrowup":
      case "up":
        if (open()) moveActive(-1)
        else openMenu()
        break
      case "home":
        if (open()) moveToEdge("first")
        break
      case "end":
        if (open()) moveToEdge("last")
        break
      case "enter":
      case "return":
        if (open()) selectActive()
        else openMenu()
        break
      case "space":
      case " ":
        if (open()) selectActive()
        else openMenu()
        break
      case "escape":
      case "esc":
        closeMenu()
        break
    }
  }

  const register = (item: Omit<RegisteredItem, "token">): (() => void) => {
    const token = Symbol("select-item")
    setItems((current) => [...current, { ...item, token }])
    return () => {
      setItems((current) => current.filter((candidate) => candidate.token !== token))
    }
  }

  // Content mounts after open. Once its items register, establish a stable
  // active option from the controlled value or the first enabled item. Solid
  // rc.3 uses an explicit compute/effect pair; the one-argument legacy form
  // throws at runtime (MISSING_EFFECT_FN).
  createEffect(
    () => ({
      isOpen: open(),
      list: items(),
      current: activeIndex(),
      value: props.value,
    }),
    ({ isOpen, list, current, value }) => {
      if (!isOpen) return
      if (current !== null && list[current] && !list[current].disabled) return
      setActiveIndex(selectedIndex(list, value) ?? firstEnabled(list))
    },
  )

  return {
    mode,
    value: () => props.value,
    open,
    items,
    toggle,
    openMenu,
    closeMenu,
    handleKey,
    inputValue,
    selectValue,
    selectActive,
    moveActive,
    moveToEdge,
    activeIndex,
    register,
  }
}

function Root(props: SelectRootProps, mode: SelectMode): HostNode {
  const state = createContextValue(props, mode)
  return createComponent(SelectContext, {
    value: state,
    children: () => {
      const node = createElement("div")
      applyStyle(node, props.style)
      if (props.children !== undefined) insert(node, props.children, null, null)
      return node
    },
  }) as HostNode
}

function SelectRoot(props: SelectRootProps): HostNode {
  return Root(props, "select")
}

function ComboboxRoot(props: SelectRootProps): HostNode {
  return Root(props, "combobox")
}

function SelectTrigger(props: SelectTriggerProps): HostNode {
  const state = context()
  const node = createElement("div")
  applyStyle(node, { tabIndex: 0, cursor: "pointer", ...props.style })
  setProp(node, "onClick", () => state.toggle())
  setProp(node, "onKeyDown", (event: SolidGpuiEvent) => state.handleKey(event))
  setProp(node, "onBlur", () => state.closeMenu())
  reactiveProp(node, "accessibility", () =>
    accessibility("combobox", state.value(), state.open(), undefined),
  )
  if (props.children !== undefined) insert(node, props.children, null, null)
  else insert(node, state.value, null, null)
  return node
}

function ComboboxTrigger(props: ComboboxTriggerProps): HostNode {
  const state = context()
  const node = createElement("input")
  applyStyle(node, { cursor: "text", ...props.style })
  if (props.placeholder !== undefined) setProp(node, "placeholder", props.placeholder)
  reactiveProp(node, "value", state.value)
  reactiveProp(node, "accessibility", () =>
    accessibility("combobox", state.value(), state.open(), undefined),
  )
  setProp(node, "onClick", () => state.openMenu())
  setProp(node, "onInput", (event: SolidGpuiEvent) => {
    if (event.type === "event" && event.value !== undefined) state.inputValue(event.value)
  })
  setProp(node, "onKeyDown", (event: SolidGpuiEvent) => state.handleKey(event))
  setProp(node, "onBlur", () => state.closeMenu())
  return node
}

function SelectContent(props: SelectContentProps): HostNode {
  const state = context()
  return createComponent(Show, {
    get when() {
      return state.open()
    },
    children: () => {
      const node = createElement("div")
      applyStyle(node, { display: "flex", flexDirection: "column", ...props.style })
      // Keep the content in layout for anchor placement but paint it above the
      // trigger and ancestors; the retained tree still owns its lifecycle.
      setProp(node, "deferred", true)
      setProp(node, "anchor", "topLeft")
      reactiveProp(node, "accessibility", () => accessibility("listbox", undefined, undefined, undefined))
      if (props.children !== undefined) insert(node, props.children, null, null)
      return node
    },
  }) as HostNode
}

function SelectItem(props: SelectItemProps): HostNode {
  const state = context()
  const unregister = state.register({ value: props.value, disabled: props.disabled === true })
  onCleanup(unregister)

  const node = createElement("div")
  applyStyle(node, { cursor: props.disabled ? "default" : "pointer", ...props.style })
  reactiveProp(node, "accessibility", () =>
    accessibility("option", undefined, undefined, state.value() === props.value),
  )
  if (!props.disabled) setProp(node, "onClick", () => state.selectValue(props.value))
  if (props.children !== undefined) insert(node, props.children, null, null)
  else insert(node, props.label ?? props.value, null, null)
  return node
}

export const select = {
  Root: SelectRoot,
  Trigger: SelectTrigger,
  Content: SelectContent,
  Item: SelectItem,
} as const

export const combobox = {
  Root: ComboboxRoot,
  Trigger: ComboboxTrigger,
  Content: SelectContent,
  Item: SelectItem,
} as const

export const Select = select
export const Combobox = combobox
