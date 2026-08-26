/**
 * Media demo (P10) — inline SVG icons tinted via `color`, a raster image
 * loaded from disk, and overlay wrappers: the badge is deferred (paints
 * above everything) and anchored to its bottom-right corner.
 *
 * Run: bun run example/media
 */
import { createSignal } from "solid-js"
import { mountJsx } from "../packages/solid/src/jsx"
import type { RenderHandle } from "../packages/solid/src/render"

const g = globalThis as { __mediaHandle?: RenderHandle }

const ICONS: { name: string; body: string }[] = [
  {
    name: "play",
    body: `<path d="M4 2 L14 8 L4 14 Z" fill="currentColor"/>`,
  },
  {
    name: "check",
    body: `<path d="M3 9 L7 13 L14 4" stroke="currentColor" stroke-width="2" fill="none"/>`,
  },
  {
    name: "star",
    body: `<path d="M8 1.5 L10 6 L15 6.5 L11 10 L12 15 L8 12.3 L4 15 L5 10 L1 6.5 L6 6 Z" fill="currentColor"/>`,
  },
  {
    name: "bell",
    body: `<path d="M8 2 C5 2 4 4.5 4 7 L4 11 L12 11 L12 7 C12 4.5 11 2 8 2 M6.5 12.5 A1.5 1.5 0 0 0 9.5 12.5" stroke="currentColor" stroke-width="1.5" fill="none"/>`,
  },
]

function Tree() {
  const [tint, setTint] = createSignal("#7aa2f7")
  const palette = ["#7aa2f7", "#bb9af7", "#9ece6a", "#f7768e"]

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        width: "100%",
        height: "100%",
        backgroundColor: "#1e1e2e",
      }}
      onClick={() => {
        const i = palette.indexOf(tint())
        setTint(palette[(i + 1) % palette.length]!)
      }}
    >
      <div style={{ fontSize: 15, color: "#cdd6f4" }}>Media elements (click to retint)</div>
      <div style={{ display: "flex", gap: 24 }}>
        {ICONS.map((icon) => (
          <svg
            src={`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>${icon.body}</svg>`}
            style={{ width: 40, height: 40, backgroundColor: "#313244", borderRadius: 8, padding: 8, color: tint() }}
          />
        ))}
      </div>
      <img
        src={new URL("./assets/media-sample.png", import.meta.url).pathname}
        style={{ width: 220, height: 140, borderRadius: 10, backgroundColor: "#181825" }}
        deferred
      />
      <div
        anchor="bottomCenter"
        style={{
          fontSize: 12,
          color: "#1e1e2e",
          backgroundColor: tint(),
          paddingX: 10,
          paddingY: 4,
          borderRadius: 6,
        }}
      >
        anchored badge
      </div>
    </div>
  )
}

mountJsx(() => <Tree />).then((handle) => {
  g.__mediaHandle = handle
  setTimeout(() => handle.dispose(), 15000)
})
