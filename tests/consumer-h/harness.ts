import { spawnHelper } from "@solid-gpui/client"
import type { Mutation, MutationBatch, SolidGpuiEvent } from "@solid-gpui/protocol"
import { render } from "@solid-gpui/solid"
import { acceptanceActions, screen } from "./fixture"

const helperPath = process.env.SOLID_GPUI_HELPER
if (!helperPath) throw new Error("SOLID_GPUI_HELPER must name the built helper")

const gui = process.env.SOLID_GPUI_GATE0_GUI === "1"
const connection = spawnHelper({ binary: helperPath, mode: gui ? "window" : "transport" })
const sent: MutationBatch[] = []
const events: SolidGpuiEvent[] = []
connection.onEvent((event) => events.push(event))
const sendBatch = connection.sendBatch.bind(connection)
connection.sendBatch = (batch) => {
  sent.push(batch)
  return sendBatch(batch)
}

function allMutations(batches: readonly MutationBatch[]): Mutation[] {
  return batches.flatMap((batch) => batch.mutations)
}

function operationNames(batches: readonly MutationBatch[]): string[] {
  return allMutations(batches).map((mutation) => mutation.op)
}

function findElementId(
  batches: readonly MutationBatch[],
  elementType: "input" | "div",
): number {
  const mutation = allMutations(batches).find(
    (candidate) => candidate.op === "createElement" && candidate.elementType === elementType,
  )
  if (!mutation || mutation.op !== "createElement") {
    throw new Error(`fixture did not create an ${elementType} element`)
  }
  return mutation.id
}

function hasSetText(batches: readonly MutationBatch[], text: string): boolean {
  return allMutations(batches).some(
    (mutation) => mutation.op === "setText" && mutation.text === text,
  )
}

function hasSetStyle(batches: readonly MutationBatch[], key: string): boolean {
  return allMutations(batches).some(
    (mutation) => mutation.op === "setStyle" && Object.hasOwn(mutation.style, key),
  )
}

let handle: Awaited<ReturnType<typeof render>> | undefined
try {
  handle = await render(screen, { connection })
  const initialBatches = sent.slice()
  const initialOps = operationNames(initialBatches)
  for (const expected of ["createElement", "setRoot", "setStyle", "setEventListener"]) {
    if (!initialOps.includes(expected)) throw new Error(`initial fixture omitted ${expected}`)
  }
  const inputId = findElementId(initialBatches, "input")
  if (!allMutations(initialBatches).some((mutation) =>
    mutation.op === "setEventListener" && mutation.id === inputId && mutation.eventType === "input" && mutation.enabled,
  )) {
    throw new Error(`input ${inputId} did not register its input listener`)
  }
  if (!allMutations(initialBatches).some((mutation) =>
    mutation.op === "setEventListener" && mutation.eventType === "click" && mutation.enabled,
  )) {
    throw new Error("fixture did not register an interactive click action")
  }
  if (!hasSetStyle(initialBatches, "backgroundColor")) {
    throw new Error("fixture did not send its styled layout")
  }
  const initialAccessibility = allMutations(initialBatches).filter(
    (mutation) => mutation.op === "setAccessibility" && mutation.accessibility !== null,
  )
  const roles = initialAccessibility.flatMap((mutation) =>
    mutation.op === "setAccessibility" && mutation.accessibility !== null
      ? [mutation.accessibility.role]
      : [],
  )
  if (!roles.includes("combobox") || !roles.includes("listbox") || roles.filter((role) => role === "option").length !== 3) {
    throw new Error(`fixture did not send the select/combobox roles: ${JSON.stringify(roles)}`)
  }

  const beforeAction = sent.length
  acceptanceActions().increment()
  await handle.renderer.flush()
  const actionBatches = sent.slice(beforeAction)
  if (!hasSetText(actionBatches, "Saved actions: 1")) {
    throw new Error(`interactive action did not update the helper: ${JSON.stringify(actionBatches)}`)
  }

  const beforeEdit = sent.length
  acceptanceActions().editQuery("acme")
  await handle.renderer.flush()
  const editBatches = sent.slice(beforeEdit)
  if (!hasSetText(editBatches, "Query: acme")) {
    throw new Error(`signal-driven input state did not cross the helper: ${JSON.stringify(editBatches)}`)
  }

  const beforeSelect = sent.length
  acceptanceActions().chooseColor("blue")
  await handle.renderer.flush()
  const selectBatches = sent.slice(beforeSelect)
  if (!hasSetText(selectBatches, "Selected: blue")) {
    throw new Error(`controlled option state did not cross the helper: ${JSON.stringify(selectBatches)}`)
  }
  if (!hasSetStyle(selectBatches, "backgroundColor")) {
    throw new Error("controlled option selection did not update its style")
  }

  if (gui) {
    const beforeEvent = sent.length
    await connection.sendCommand({ type: "simulateInput", seq: 4_000, id: inputId, text: "live" })
    // The helper writes the input event from its GPUI main thread while the
    // stdin thread answers the command; order across pipes is not guaranteed,
    // so poll like the helper's own window tests instead of trusting one
    // macrotask turn (bounded: ~2s worst case, settles in one turn normally).
    let settled = false
    for (let attempt = 0; attempt < 40 && !settled; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
      await handle.renderer.flush()
      settled =
        events.some((event) => event.type === "event" && event.id === inputId && event.eventType === "input") &&
        hasSetText(sent.slice(beforeEvent), "Query: live")
    }
    const eventBatches = sent.slice(beforeEvent)
    if (!events.some((event) => event.type === "event" && event.id === inputId && event.eventType === "input")) {
      throw new Error(`real helper did not emit the input event: ${JSON.stringify(events)}`)
    }
    if (!hasSetText(eventBatches, "Query: live")) {
      throw new Error(`real input event did not drive a mutation: ${JSON.stringify(eventBatches)}`)
    }

    console.log(JSON.stringify({ mode: "window", inputId, event: "input", eventBatches: eventBatches.length }))
  } else {
    console.log(JSON.stringify({
      mode: "transport",
      inputId,
      initialBatches: initialBatches.length,
      editBatches: editBatches.length,
      selectBatches: selectBatches.length,
      nativeEvent: "not-injected; run with SOLID_GPUI_GATE0_GUI=1",
    }))
  }
} finally {
  if (handle) await handle.dispose()
  else await connection.close()
}
