/** @jsxImportSource @solid-gpui/solid */
import { createSignal } from "solid-js"
import { Dynamic } from "@solid-gpui/solid"

export const [label, setLabel] = createSignal("initial")
const initialPane = "chart" as "chart" | "notes"
export const [pane, setPane] = createSignal(initialPane)

function ChartPane() {
  return <div>chart pane</div>
}

function NotesPane() {
  return <div>notes pane</div>
}

export function App() {
  return (
    <div class="p-4 flex gap-4 hover:bg-blue-500" style={{ display: "flex", gap: 4 }} onClick={() => undefined}>
      <span>{label()}</span>
      <input value={label()} placeholder="Label" />
      <Dynamic component={pane() === "chart" ? ChartPane : NotesPane} />
    </div>
  )
}
