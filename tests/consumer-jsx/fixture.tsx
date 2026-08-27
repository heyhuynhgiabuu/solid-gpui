/** @jsxImportSource @solid-gpui/solid */
import { createSignal } from "solid-js"
import type { JSX } from "@solid-gpui/solid/jsx-runtime"
import type { JSX as DevJSX } from "@solid-gpui/solid/jsx-dev-runtime"
import { mountJsx } from "@solid-gpui/solid/jsx"

const [count, setCount] = createSignal(0)

const onClick: JSX.EventHandler<"click"> = (event) => {
  const id: number = event.id
  void id
}

const onInput: JSX.EventHandler<"input"> = (event) => {
  const value: string | undefined = event.value
  void value
}

const view: JSX.Element = (
  <div
    style={{ display: "flex", gap: 8 }}
    hoverStyle={{ backgroundColor: "#111" }}
    tooltip="A typed tooltip"
    onClick={onClick}
  >
    <input value={String(count())} placeholder="Count" onInput={onInput} />
    <text runs={[{ text: "Count", weight: 400 }]} />
    <markdown source="# title" />
  </div>
)

// The renderer has no browser class/CSS fallback. This must remain a type error
// until a separately designed utility-class adapter exists.
// @ts-expect-error className is not part of the GPUI JSX surface
const unsupportedClassName = <div className="p-4" />
// Focus configuration is currently expressed through the typed style map;
// these DOM-style props must not be accepted and then disappear at runtime.
// @ts-expect-error tabIndex is not a GPUI JSX input prop
const unsupportedTabIndex = <input tabIndex={0} />
// @ts-expect-error autoFocus is not a GPUI JSX input prop
const unsupportedAutoFocus = <input autoFocus />

setCount(1)
const devView: DevJSX.Element = view
void devView
void view
void unsupportedClassName
void unsupportedTabIndex
void unsupportedAutoFocus
void mountJsx(() => view, {})
