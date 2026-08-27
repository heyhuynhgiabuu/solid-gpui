import { createSignal } from "solid-js"
import type { AccessibilityState, SolidGpuiEvent, StyleMap } from "@solid-gpui/protocol"
import type { H, HostNode } from "@solid-gpui/solid"

export interface AcceptanceActions {
  readonly increment: () => void
  readonly editQuery: (value: string) => void
  readonly chooseColor: (value: string) => void
}

let mountedActions: AcceptanceActions | undefined

/** Test harness seam; the screen itself remains an ordinary h()-authored tree. */
export function acceptanceActions(): AcceptanceActions {
  if (!mountedActions) throw new Error("acceptance screen has not mounted")
  return mountedActions
}

const optionColors: Record<string, string> = {
  red: "#f38ba8",
  green: "#a6e3a1",
  blue: "#89b4fa",
}

function optionStyle(selected: () => boolean, color: string): () => StyleMap {
  return () => ({
    padding: 6,
    borderRadius: 4,
    color,
    cursor: "pointer",
    backgroundColor: selected() ? "#45475a" : "#313244",
  })
}

function optionAccessibility(selected: () => boolean): () => AccessibilityState {
  return () => ({ role: "option", selected: selected() })
}

/**
 * Representative SaaS screen for Gate 0. Keep this on the public h()/render()
 * surface so the acceptance path does not accidentally depend on JSX internals.
 */
export function screen(h: H): HostNode {

  const [count, setCount] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [color, setColor] = createSignal("red")

  const chooseColor = (value: string): void => {
    if (optionColors[value] === undefined) return
    setColor(value)
    setQuery(value)
  }

  const increment = (): void => {
    setCount((value) => value + 1)
  }
  mountedActions = {
    increment,
    editQuery: setQuery,
    chooseColor,
  }

  const onInput = (event: SolidGpuiEvent): void => {
    if (event.type === "event" && event.eventType === "input") {
      setQuery(event.value ?? "")
    }
  }

  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 24,
        width: 360,
        height: 420,
        backgroundColor: "#1e1e2e",
        color: "#cdd6f4",
      },
    },
    h("div", { style: { fontSize: 22, color: "#cdd6f4" } }, "Workspace settings"),
    h("div", { style: { fontSize: 13, color: "#a6adc8" } }, () => `Saved actions: ${count()}`),
    h(
      "input",
      {
        style: {
          width: 300,
          padding: 8,
          borderRadius: 6,
          backgroundColor: "#313244",
          color: "#cdd6f4",
        },
        placeholder: "Search colors",
        value: query(),
        accessibility: () => ({ role: "combobox", value: query(), expanded: true }),
        onInput,
      },
    ),
    h(
      "div",
      {
        style: {
          padding: 9,
          borderRadius: 6,
          backgroundColor: "#89b4fa",
          color: "#1e1e2e",
          cursor: "pointer",
        },
        onClick: increment,
      },
      "Save changes",
    ),
    h("div", { style: { fontSize: 13, color: "#a6adc8" } }, () => `Query: ${query()}`),
    h("div", { style: { fontSize: 13, color: "#a6adc8" } }, () => `Selected: ${color()}`),
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: 6,
          backgroundColor: "#181825",
          borderRadius: 6,
        },
        accessibility: { role: "listbox" },
      },
      h(
        "div",
        {
          style: optionStyle(() => color() === "red", optionColors.red),
          accessibility: optionAccessibility(() => color() === "red"),
          onClick: () => chooseColor("red"),
        },
        "Red",
      ),
      h(
        "div",
        {
          style: optionStyle(() => color() === "green", optionColors.green),
          accessibility: optionAccessibility(() => color() === "green"),
          onClick: () => chooseColor("green"),
        },
        "Green",
      ),
      h(
        "div",
        {
          style: optionStyle(() => color() === "blue", optionColors.blue),
          accessibility: optionAccessibility(() => color() === "blue"),
          onClick: () => chooseColor("blue"),
        },
        "Blue",
      ),
    ),
  )
}
