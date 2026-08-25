/**
 * Counter demo, JSX edition (S15) — `bun run example/counter:tsx`.
 *
 * Same behavior as examples/counter.ts, authored in real JSX: the .tsx is
 * compiled at load time by scripts/solid-jsx-preload.ts through
 * babel-preset-solid { generate: "universal" }, targeting the module-level
 * runtime in packages/solid/src/jsx.
 */
import { createSignal } from "solid-js"
import { mountJsx } from "../packages/solid/src/jsx"

const g = globalThis as { __counterTsxHandle?: import("../packages/solid/src/render").RenderHandle }

function Tree() {
  const [count, setCount] = createSignal(0)
  const [pressed, setPressed] = createSignal(false)
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        width: "100%",
        height: "100%",
        backgroundColor: "#1e1e2e",
      }}
    >
      <div style={{ fontSize: 28, color: "#cdd6f4" }}>Count: {count()}</div>
      <div
        style={{
          padding: "10px 18px",
          borderRadius: 8,
          backgroundColor: pressed() ? "#89b4fa" : "#45475a",
          color: "#1e1e2e",
          cursor: "pointer",
        }}
        hoverStyle={{
          backgroundColor: "rgba(137, 180, 250, 0.35)",
          borderRadius: 12,
        }}
        activeStyle={{
          backgroundColor: "hsl(220, 50%, 40%)",
        }}
        onClick={() => setCount((c) => c + 1)}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
      >
        increment (click me)
      </div>
      <div style={{ fontSize: 12, color: "#6c7086" }}>JSX edition — S15</div>
    </div>
  )
}

if (!g.__counterTsxHandle) {
  g.__counterTsxHandle = await mountJsx(() => <Tree />)
  const mounted = g.__counterTsxHandle
  void mounted.connection.exited.then(() => {
    if (g.__counterTsxHandle === mounted) g.__counterTsxHandle = undefined
  })
  g.__counterTsxHandle.connection.onEvent((ev) => {
    console.log(`event: ${ev.eventType} on #${ev.id} at (${ev.x ?? "?"}, ${ev.y ?? "?"})`)
  })
  process.on("SIGINT", () => {
    // Never hang on teardown: dispose races a hard cap, exit regardless.
    const handle = g.__counterTsxHandle
    g.__counterTsxHandle = undefined
    if (!handle) process.exit(0)
    void Promise.race([
      handle.dispose().catch((err) => console.error("[solid-gpui] dispose failed:", err)),
      new Promise((r) => setTimeout(r, 3000)),
    ]).then(() => process.exit(0))
  })
  console.log("mounted (JSX) — click the button; Ctrl+C here to exit")
} else {
  await g.__counterTsxHandle.update(() => <Tree />)
  console.log("remounted (hot)")
}
