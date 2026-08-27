/** @jsxImportSource @solid-gpui/solid */
import { createSignal } from "solid-js"

export const [label, setLabel] = createSignal("initial")

export function App() {
  return (
    <div class="p-4 flex gap-4 hover:bg-blue-500" style={{ display: "flex", gap: 4 }} onClick={() => undefined}>
      <span>{label()}</span>
      <input value={label()} placeholder="Label" />
    </div>
  )
}
