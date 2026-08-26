/**
 * Canvas demo (P8) — a live bar chart drawn as a recorded draw list:
 * rects for bars, a stroked path baseline, text labels. The list is
 * rebuilt on every signal tick, exercising replace-wholesale semantics.
 *
 * Run: bun run example/canvas
 */
import { createSignal, onCleanup } from "solid-js"
import { mountJsx } from "../packages/solid/src/jsx"
import type { RenderHandle } from "../packages/solid/src/render"

const g = globalThis as { __canvasHandle?: RenderHandle }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
const BAR_W = 40
const GAP = 20
const BASE_Y = 170

function Tree() {
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((t) => t + 1), 120)
  onCleanup(() => clearInterval(timer))

  const heights = () =>
    MONTHS.map((_, i) => 20 + 40 * Math.abs(Math.sin(tick() / 8 + i)))

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#1a1b26",
        width: "100%",
        height: "100%",
      }}
    >
      <div style={{ fontSize: 16, color: "#c0caf5", marginBottom: 12 }}>
        Revenue by month
      </div>
      <canvas
        style={{ width: 360, height: 200, backgroundColor: "#16161e" }}
        drawList={[
          {
            type: "path",
            points: [0, BASE_Y, 359, BASE_Y],
            color: "#414868",
            strokeWidth: 1,
          },
          ...MONTHS.map((m, i) => ({
            type: "rect" as const,
            x: 10 + i * (BAR_W + GAP),
            y: BASE_Y - heights()[i],
            w: BAR_W,
            h: heights()[i],
            color: i % 2 === 0 ? "#7aa2f7" : "#bb9af7",
            cornerRadius: 3,
          })),
          ...MONTHS.map((m, i) => ({
            type: "text" as const,
            x: 14 + i * (BAR_W + GAP),
            y: BASE_Y + 20,
            text: m,
            size: 11,
            color: "#565f89",
          })),
        ]}
      />
    </div>
  )
}

mountJsx(Tree).then((handle) => {
  g.__canvasHandle = handle
  setTimeout(() => handle.dispose(), 6000)
})
