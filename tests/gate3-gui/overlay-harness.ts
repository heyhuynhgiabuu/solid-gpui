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

/**
 * Gate 3 GUI evidence: a REAL window opens a select overlay, navigates it,
 * selects, dismisses it by an outside pointer press, and destroys it — with
 * no stale listener state. Every input is a REAL dispatched event
 * (simulateKey / simulateMouse commands), never a synthetic edit.
 *
 * Known limitation recorded with this harness: synthetic KEYSTROKE dispatch
 * develops a handled=false anomaly after the first autoFocus overlay cycle
 * (pointer dispatch stays healthy), so the reopen rides a real click.
 *
 * Requires SOLID_GPUI_HELPER and a window server; run via
 * scripts/gate3-gui-smoke.ts.
 */
import { spawnHelper, type HelperConnection } from "@solid-gpui/client"
import type { Mutation, MutationBatch, SolidGpuiEvent, SolidGpuiCommand } from "@solid-gpui/protocol"
import { mountJsx } from "@solid-gpui/solid/jsx"
import { buildScreen } from "./fixture"

const helperPath = process.env.SOLID_GPUI_HELPER
if (!helperPath) throw new Error("SOLID_GPUI_HELPER must name the built helper")

const connection: HelperConnection = spawnHelper({ binary: helperPath, mode: "window" })
const sent: MutationBatch[] = []
const events: SolidGpuiEvent[] = []
connection.onEvent((event) => events.push(event))
const sendBatch = connection.sendBatch.bind(connection)
connection.sendBatch = (batch) => {
  sent.push(batch)
  return sendBatch(batch)
}

let seq = 9_000
/** Distributive Omit: SolidGpuiCommand is a union, so a plain Omit would
 * collapse it to the shared keys. */
type CommandInput<T> = T extends (infer C extends object) ? Omit<C, "seq"> : never
async function command(command_: CommandInput<SolidGpuiCommand>): Promise<unknown> {
  seq += 1
  return connection.sendCommand({ ...command_, seq } as SolidGpuiCommand)
}

function mutations(): Mutation[] {
  return sent.flatMap((batch) => batch.mutations)
}

function mutationCountAt(batchCount: number): number {
  return sent.slice(0, batchCount).reduce((count, batch) => count + batch.mutations.length, 0)
}

const contentIdOf = (afterBatch: number): number | undefined =>
  mutations()
    .slice(mutationCountAt(afterBatch))
    .filter(
      (mutation): mutation is Extract<Mutation, { op: "setDeferred" }> =>
        mutation.op === "setDeferred" && mutation.deferred,
    )
    .at(-1)?.id

/** Bounded poll: commands answer from the stdin thread while events and
 * mutations flow from the GPUI main thread — cross-pipe ordering is not
 * guaranteed, so wait like the helper's own window tests do. */
async function until(flush: () => Promise<void>, predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 120 && !predicate(); attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    await flush()
  }
  if (!predicate()) throw new Error(`timed out waiting for ${label}`)
}

let value: () => string = () => ""
let handle: Awaited<ReturnType<typeof mountJsx>> | undefined
try {
  // The JSX runtime suite initializes inside mountJsx — building the fixture
  // eagerly at module scope would call createElement before init.
  handle = await mountJsx(
    () => {
      const built = buildScreen()
      value = built.value
      return built.screen
    },
    { connection },
  )
  await handle.renderer.flush()

  const all = mutations()
  // Solid double-invokes children functions, so the FIRST click-listener div
  // can be a discarded, never-attached duplicate (its focus handle answers
  // focusElement but nothing paints — dispatch finds no node). The LAST one
  // is the live trigger; items are unmounted while the menu is closed.
  const triggerListener = all
    .filter(
      (mutation): mutation is Extract<Mutation, { op: "setEventListener" }> =>
        mutation.op === "setEventListener" && mutation.eventType === "click" && mutation.enabled,
    )
    .at(-1)
  if (!triggerListener) {
    throw new Error(`trigger click listener missing: ${JSON.stringify(all.map((m) => m.op))}`)
  }
  const trigger = triggerListener.id

  // 1. Focus the trigger, then OPEN with a real Enter keystroke.
  await command({ type: "focusElement", id: trigger })
  const atOpen = sent.length
  await command({ type: "simulateKey", key: "enter" })
  await until(
    handle.renderer.flush,
    () =>
      contentIdOf(atOpen) !== undefined &&
      mutations()
        .slice(mutationCountAt(atOpen))
        .some((m) => m.op === "setAccessibility" && m.accessibility?.role === "listbox"),
    "menu opens (content mounts with listbox role)",
  )
  const openedContent = contentIdOf(atOpen)
  // Gate 3-b transfer: the autoFocus content receives REAL focus.
  await until(
    handle.renderer.flush,
    () =>
      events.some(
        (event) => event.type === "event" && event.eventType === "focus" && event.id === openedContent,
      ),
    "focus transfers into the opened overlay",
  )
  console.log(JSON.stringify({ step: "open", trigger, content: openedContent }))

  // 2. Navigate with a real ArrowDown into the focused overlay.
  await command({ type: "simulateKey", key: "down" })
  await until(
    handle.renderer.flush,
    () =>
      events.some(
        (event) =>
          event.type === "event" &&
          event.eventType === "keyDown" &&
          event.key === "down" &&
          event.id === openedContent,
      ),
    "arrow keyDown reaches the focused overlay content",
  )

  // 3. SELECT with a real Enter: value crosses and the overlay unmounts.
  const atSelect = sent.length
  await command({ type: "simulateKey", key: "enter" })
  await until(
    handle.renderer.flush,
    () =>
      mutations()
        .slice(mutationCountAt(atSelect))
        .some((m) => m.op === "removeChild") &&
      mutations()
        .slice(mutationCountAt(atSelect))
        .some((m) => m.op === "setText" && m.text.includes("selected")),
    "selection updates state and unmounts the overlay",
  )
  if (value() === "red") throw new Error(`selection did not move the value: ${value()}`)
  console.log(JSON.stringify({ step: "select", value: value() }))

  // 4. Reopen with a real Enter on the restored trigger (Gate 5-b's
  //    immediate restore keeps synthetic dispatch healthy), then DISMISS
  //    with a real outside press.
  const atReopen = sent.length
  await command({ type: "simulateKey", key: "enter" })
  await until(
    handle.renderer.flush,
    () => contentIdOf(atReopen) !== undefined,
    "menu reopens (Enter on the restored trigger)",
  )
  const reopened = contentIdOf(atReopen)
  const atDismiss = sent.length
  await command({ type: "simulateMouse", x: 620, y: 420 })
  await until(
    handle.renderer.flush,
    () =>
      mutations().slice(mutationCountAt(atDismiss)).some((m) => m.op === "removeChild") &&
      events.some((event) => event.type === "event" && event.eventType === "outsideClick"),
    "outside press dismisses the overlay via outsideClick",
  )
  console.log(JSON.stringify({ step: "dismiss", content: reopened }))

  // 5. DESTROY: dispose and close cleanly; nothing may hang or crash.
  await handle.dispose()
  await connection.close()
  console.log("GATE3 GUI EVIDENCE OK — open/navigate/select/dismiss/destroy on a real window")
} catch (error) {
  console.error("GATE3 GUI EVIDENCE FAILED:", error)
  console.error("events:", JSON.stringify(events.slice(-12)))
  console.error(
    "last ops:",
    JSON.stringify(mutations().slice(-14).map((m) => ({ op: m.op, id: (m as { id?: number }).id }))),
  )
  process.exitCode = 1
  if (handle) await handle.dispose()
  else await connection.close()
}
