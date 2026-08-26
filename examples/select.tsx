/**
 * S14b headless select/combobox demo.
 *
 * Run with: bun run example/select
 */
import { createSignal } from "solid-js"
import { combobox, select } from "../packages/solid/src"
import { mountJsx } from "../packages/solid/src/jsx"

const g = globalThis as { __selectHandle?: import("../packages/solid/src/render").RenderHandle }

function Tree() {
  const [color, setColor] = createSignal("red")
  const [query, setQuery] = createSignal("")

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 24,
        width: 360,
        height: 280,
        backgroundColor: "#1e1e2e",
      }}
    >
      <div style={{ color: "#cdd6f4", fontSize: 18 }}>Headless controls</div>
      <select.Root value={color()} onValueChange={setColor}>
        <select.Trigger
          style={{
            paddingX: 10,
            paddingY: 8,
            backgroundColor: "#313244",
            color: "#cdd6f4",
            borderRadius: 6,
          }}
        >
          {color()}
        </select.Trigger>
        <select.Content
          style={{
            padding: 6,
            gap: 4,
            backgroundColor: "#313244",
            borderRadius: 6,
          }}
        >
          <select.Item value="red" style={{ padding: 6, color: "#f38ba8" }}>
            Red
          </select.Item>
          <select.Item value="green" style={{ padding: 6, color: "#a6e3a1" }}>
            Green
          </select.Item>
          <select.Item value="blue" style={{ padding: 6, color: "#89b4fa" }}>
            Blue
          </select.Item>
        </select.Content>
      </select.Root>
      <div style={{ color: "#a6adc8", fontSize: 12 }}>Selected: {color()}</div>

      <combobox.Root value={query()} onValueChange={setQuery}>
        <combobox.Trigger
          placeholder="Type a color"
          style={{
            paddingX: 10,
            paddingY: 8,
            backgroundColor: "#313244",
            color: "#cdd6f4",
            borderRadius: 6,
          }}
        />
        <combobox.Content
          style={{
            padding: 6,
            gap: 4,
            backgroundColor: "#313244",
            borderRadius: 6,
          }}
        >
          <combobox.Item value="red" label="Red" style={{ padding: 6, color: "#f38ba8" }} />
          <combobox.Item value="green" label="Green" style={{ padding: 6, color: "#a6e3a1" }} />
          <combobox.Item value="blue" label="Blue" style={{ padding: 6, color: "#89b4fa" }} />
        </combobox.Content>
      </combobox.Root>
    </div>
  )
}

if (!g.__selectHandle) {
  g.__selectHandle = await mountJsx(() => <Tree />)
  const handle = g.__selectHandle
  setTimeout(() => {
    void handle.dispose()
    g.__selectHandle = undefined
  }, 8000)
  console.log("mounted select/combobox demo — closes after 8s")
}
