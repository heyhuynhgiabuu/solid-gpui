/*
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

/** @jsxImportSource @solid-gpui/solid */

/**
 * MANUAL real-keyboard probe (Gate 3-d debt): everything the synthetic
 * harness cannot prove — real keystrokes, real IME composition. Run it,
 * follow the on-screen steps, and watch the event log (window) and stdout
 * lines. Nothing is automated here by design.
 *
 *   bun --conditions=browser --preload ./scripts/solid-jsx-preload.ts \
 *     scripts/manual-keyboard-probe.tsx
 *
 * (Historical note: an earlier deferred-restore design broke synthetic
 * dispatch after the first autoFocus cycle — fixed by immediate restore.)
 *
 * What to check:
 *  1. Click the select → ArrowDown ×2 → Enter: value becomes blue, menu
 *     closes, keyDown events appear in the log.
 *  2. Click into the input, switch on a Vietnamese Telex (or any IME), type
 *     "vieetj" and watch the MARKED text commit to "việt" — during
 *     composition the open menu must NOT navigate (Gate 3-c suppression);
 *     arrows move IME candidates, not the list.
 *  3. After the composition commits, ArrowDown DOES navigate the list.
 *  4. Escape with focus in the input closes the menu.
 *  5. Cmd/Ctrl+Q (or close the window) quits cleanly — the process must
 *     exit 0 with no stderr panic.
 */
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spawnHelper } from "@solid-gpui/client"
import { createSignal, For } from "solid-js"
import { mountJsx } from "@solid-gpui/solid/jsx"
import { combobox } from "@solid-gpui/solid"

const helperPath =
  process.env.SOLID_GPUI_HELPER ??
  fileURLToPath(new URL("../target/debug/solid-gpui-helper", import.meta.url))
if (!existsSync(helperPath)) {
  throw new Error(`helper binary missing at ${helperPath}; run cargo build -p solid-gpui-helper first`)
}

const connection = spawnHelper({ binary: helperPath, mode: "window" })
const [log, setLog] = createSignal<string[]>([])
let events: string[] = []
const push = (line: string): void => {
  events = [...events.slice(-9), line]
  setLog(events)
  console.log("EVENT:", line)
}
connection.onEvent((event) => {
  if (event.type === "event") {
    const key = event.key === undefined ? "" : ` key=${event.key}`
    push(`#${event.id} ${event.eventType}${key}`)
  } else {
    push(JSON.stringify(event))
  }
})

const [value, setValue] = createSignal("")
const [open, setOpen] = createSignal(false)

const INSTRUCTIONS = [
  "MANUAL KEYBOARD PROBE — real keys, real IME.",
  "",
  "1. Click the select below → ArrowDown ×2 → Enter",
  "   expect: value becomes nam, menu closes, keyDown events in the log.",
  "2. Click the input, turn on Vietnamese Telex (or any IME), type 'vieetj'.",
  "   expect: marked text commits to 'việt'; while composing, the open",
  "   menu must NOT navigate (Gate 3-c suppression).",
  "3. After commit, ArrowDown DOES move the menu selection.",
  "4. Escape closes the menu.",
  "5. Close the window: process must exit 0, no stderr panic.",
]

let handle: Awaited<ReturnType<typeof mountJsx>> | undefined
try {
  handle = await mountJsx(
    () => (
      <div style={{ padding: 20, flexDirection: "column", gap: 12 }}>
        <div style={{ fontWeight: 700 }}>Manual keyboard probe</div>
        <div style={{ flexDirection: "column", gap: 2, opacity: 0.85 }}>
          <For each={INSTRUCTIONS}>{(line) => <div>{line}</div>}</For>
        </div>
        <div style={{ borderTop: 1, paddingTop: 12, flexDirection: "column", gap: 10 }}>
          <combobox.Root
            value={value()}
            onValueChange={(next: string) => setValue(next)}
            onOpenChange={(o: boolean) => setOpen(o)}
          >
            <combobox.Trigger placeholder="Type with your IME…" />
            <combobox.Content style={{ width: 200 }}>
              <combobox.Item value="việt">việt</combobox.Item>
              <combobox.Item value="nam">nam</combobox.Item>
              <combobox.Item value="keyboard">keyboard</combobox.Item>
            </combobox.Content>
          </combobox.Root>
        </div>
        <div style={{ borderTop: 1, paddingTop: 12, flexDirection: "column", gap: 2 }}>
          <div style={{ fontWeight: 700 }}>event log (last 10)</div>
          <For each={log()}>{(line) => <div>{line}</div>}</For>
        </div>
      </div>
    ),
    { connection },
  )
  await handle.renderer.flush()
  console.log("PROBE READY — interact with the window, then close it.")
  const exit = await connection.exited
  console.log("PROBE DONE — helper exit:", JSON.stringify(exit))
  if (exit.code !== 0 && exit.code !== null) process.exitCode = 1
} catch (error) {
  console.error("PROBE FAILED:", error)
  process.exitCode = 1
  if (handle) await handle.dispose()
  else await connection.close()
}
