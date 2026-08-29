/*
 * Copyright 2026 the solid-gpui authors
 *
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
 * Widget gallery — one window exercising the supported surface:
 * buttons with hover/active state layers, controlled input, select,
 * markdown, a scroll area, transitionMs animation, and setTheme
 * (the light/dark toggle is a REAL setTheme round-trip, not CSS).
 *
 * Run with: bun run example/gallery
 */
import { createSignal, For } from "solid-js"
import { mountJsx } from "../packages/solid/src/jsx"
import { select, theme } from "../packages/solid/src"
import type { RenderHandle } from "../packages/solid/src/render"

const g = globalThis as { __galleryHandle?: RenderHandle }

const LIGHT = { surface: "#eff1f5", foreground: "#4c4f69" }
const DARK = { surface: "#1e1e2e", foreground: "#cdd6f4" }

function Section(props: { title: string; children: unknown }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: "#7f849c" }}>
        {props.title}
      </div>
      {props.children}
    </div>
  )
}

function Tree() {
  const [count, setCount] = createSignal(0)
  const [name, setName] = createSignal("")
  const [color, setColor] = createSignal("green")
  const [wide, setWide] = createSignal(false)
  const [dark, setDark] = createSignal(true)
  const accent = "#89b4fa"

  const toggleTheme = () => {
    const next = dark()
    setDark(next)
    const handle = g.__galleryHandle
    if (handle) void theme.set(handle.connection, next ? DARK : LIGHT)
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 20,
        width: 520,
        height: 600,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
        <div style={{ fontSize: 20, color: accent, width: "100%" }}>
          solid-gpui gallery
        </div>
        <div
          style={{
            paddingX: 10,
            paddingY: 6,
            borderRadius: 6,
            backgroundColor: "#45475a",
            color: "#cdd6f4",
            cursor: "pointer",
          }}
          hoverStyle={{ backgroundColor: "#585b70" }}
          onClick={toggleTheme}
        >
          {dark() ? "☀ light" : "☾ dark"}
        </div>
      </div>

      <Section title="buttons · state layers · animation">
        <div style={{ display: "flex", flexDirection: "row", gap: 10, alignItems: "center" }}>
          <div
            style={{
              paddingX: 14,
              paddingY: 8,
              borderRadius: 8,
              backgroundColor: accent,
              color: "#1e1e2e",
              cursor: "pointer",
            }}
            hoverStyle={{ backgroundColor: "#b4befe" }}
            activeStyle={{ backgroundColor: "#74c7ec" }}
            onClick={() => setCount((c) => c + 1)}
          >
            clicked {count()}×
          </div>
          <div
            style={{
              paddingX: 14,
              paddingY: 8,
              borderRadius: 8,
              border: "1 solid #585b70",
              color: "#cdd6f4",
              cursor: "pointer",
            }}
            hoverStyle={{ border: "1 solid #89b4fa" }}
            onClick={() => setWide((w) => !w)}
          >
            animate
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 4,
              backgroundColor: "#a6e3a1",
              transitionMs: 250,
              width: wide() ? 180 : 60,
            }}
          />
        </div>
      </Section>

      <Section title="controlled input">
        <input
          value={name()}
          placeholder="type your name…"
          onInput={(event) => setName(event.value ?? "")}
          style={{
            paddingX: 10,
            paddingY: 8,
            borderRadius: 6,
            backgroundColor: "#313244",
            color: "#cdd6f4",
            width: 280,
          }}
        />
        <div style={{ color: "#a6adc8" }}>
          {name() ? `hello, ${name()}!` : "the value below mirrors the input"}
        </div>
      </Section>

      <Section title="select">
        <select.Root value={color()} onValueChange={setColor}>
          <select.Trigger
            style={{
              paddingX: 10,
              paddingY: 8,
              backgroundColor: "#313244",
              color: "#cdd6f4",
              borderRadius: 6,
              width: 140,
            }}
          >
            {color()}
          </select.Trigger>
          <select.Content
            style={{ padding: 6, gap: 4, backgroundColor: "#313244", borderRadius: 6 }}
          >
            <For each={["red", "green", "blue"]}>
              {(item) => (
                <select.Item value={item} style={{ paddingX: 10, paddingY: 6, borderRadius: 4 }}>
                  {item}
                </select.Item>
              )}
            </For>
          </select.Content>
        </select.Root>
      </Section>

      <Section title="markdown">
        <markdown
          source={"### rendered host-side\n**bold**, *italic*, `inline code` and [links](https://github.com) never cross the wire as elements."}
          style={{ width: "100%" }}
        />
      </Section>

      <Section title="scroll area">
        <div
          style={{
            height: 96,
            width: "100%",
            overflow: "scroll",
            border: "1 solid #45475a",
            borderRadius: 8,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <For each={Array.from({ length: 24 }, (_, i) => i + 1)}>
            {(row) => (
              <div style={{ color: "#a6adc8", fontSize: 12 }}>
                row {row} — virtual or scrolled, the helper owns the paint
              </div>
            )}
          </For>
        </div>
      </Section>
    </div>
  )
}

if (!g.__galleryHandle) {
  g.__galleryHandle = await mountJsx(() => <Tree />)
  const handle = g.__galleryHandle
  void handle.connection.exited.then(() => {
    if (g.__galleryHandle === handle) g.__galleryHandle = undefined
  })
  process.on("SIGINT", () => {
    const h = g.__galleryHandle
    g.__galleryHandle = undefined
    if (!h) process.exit(0)
    void Promise.race([
      h.dispose().catch((err) => console.error("[solid-gpui] dispose failed:", err)),
      new Promise((r) => setTimeout(r, 3000)),
    ]).then(() => process.exit(0))
  })
  console.log("gallery mounted — toggle the theme, click around; Ctrl+C to exit")
} else {
  await g.__galleryHandle.update(() => <Tree />)
  console.log("remounted (hot)")
}
