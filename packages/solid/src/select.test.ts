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

import { describe, expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { EVENT_TYPES, type Mutation, type MutationBatch, type SolidGpuiEvent } from "@solid-gpui/protocol"
import {
  createComponent,
  createElement,
  createTextNode,
  initJsxRuntime,
  resetJsxRuntime,
} from "./jsx"
import type { HostNode, Send } from "./renderer"
import { combobox, select } from "./select"

function recording(): { send: Send; batches: MutationBatch[] } {
  const batches: MutationBatch[] = []
  return {
    batches,
    send: async (batch) => {
      batches.push(batch)
      return { seq: batch.seq, applied: batch.mutations.length }
    },
  }
}

function event(
  id: number,
  eventType: "click" | "keyDown" | "input",
  fields: { key?: string; value?: string } = {},
): SolidGpuiEvent {
  return {
    type: "event",
    id,
    eventType,
    ...(fields.key === undefined ? {} : { key: fields.key }),
    ...(fields.value === undefined ? {} : { value: fields.value }),
  } as SolidGpuiEvent
}

describe("select primitives", () => {
  test("opens, navigates with keys, selects a value, and updates typed states", async () => {
    const rec = recording()
    const suite = initJsxRuntime(rec.send)
    const [value, setValue] = createSignal("red")
    const changes: string[] = []
    const container = createElement("#root")

    try {
      const dispose = suite.render(
        () =>
          createComponent(select.Root, {
            get value() {
              return value()
            },
            onValueChange: (next: string) => {
              changes.push(next)
              setValue(next)
            },
            children: () => [
              createComponent(select.Trigger, {
                children: () => createTextNode("Color"),
              }),
              createComponent(select.Content, {
                children: () => [
                  createComponent(select.Item, {
                    value: "red",
                    children: () => createTextNode("Red"),
                  }),
                  createComponent(select.Item, {
                    value: "blue",
                    disabled: true,
                    children: () => createTextNode("Blue"),
                  }),
                  createComponent(select.Item, {
                    value: "green",
                    children: () => createTextNode("Green"),
                  }),
                ],
              }),
            ],
          }) as HostNode,
        container,
      )
      await suite.flush()

      const triggerId = rec.batches[0]?.mutations.find(
        (mutation): mutation is Extract<Mutation, { op: "setEventListener" }> =>
          mutation.op === "setEventListener" && mutation.eventType === "click",
      )?.id
      expect(triggerId).toBeDefined()
      expect(
        rec.batches[0]?.mutations.some(
          (mutation) =>
            mutation.op === "setAccessibility" &&
            mutation.accessibility?.role === "combobox" &&
            mutation.accessibility.expanded === false,
        ),
      ).toBe(true)

      suite.handler(triggerId!, "click")?.(event(triggerId!, "click"))
      await suite.flush()
      const opened = rec.batches.slice(1).flatMap((batch) => batch.mutations)
      expect(
        opened.some(
          (mutation) =>
            mutation.op === "setAccessibility" &&
            mutation.accessibility?.role === "listbox",
        ),
      ).toBe(true)
      expect(
        opened.some(
          (mutation) =>
            mutation.op === "setAccessibility" &&
            mutation.accessibility?.role === "option" &&
            mutation.accessibility.selected === true,
        ),
      ).toBe(true)

      suite.handler(triggerId!, "keyDown")?.(event(triggerId!, "keyDown", { key: "Escape" }))
      await suite.flush()
      expect(
        rec.batches.slice(-1)[0]?.mutations.some(
          (mutation) =>
            mutation.op === "setAccessibility" &&
            mutation.accessibility?.role === "combobox" &&
            mutation.accessibility.expanded === false,
        ),
      ).toBe(true)

      suite.handler(triggerId!, "click")?.(event(triggerId!, "click"))
      await suite.flush()
      suite.handler(triggerId!, "keyDown")?.(event(triggerId!, "keyDown", { key: "ArrowDown" }))
      await suite.flush()
      suite.handler(triggerId!, "keyDown")?.(event(triggerId!, "keyDown", { key: "Enter" }))
      await suite.flush()

      expect(changes).toEqual(["green"])
      expect(value()).toBe("green")
      const all = rec.batches.flatMap((batch) => batch.mutations)
      expect(
        all.some(
          (mutation) =>
            mutation.op === "setAccessibility" &&
            mutation.accessibility?.role === "combobox" &&
            mutation.accessibility.expanded === false &&
            mutation.accessibility.value === "green",
        ),
      ).toBe(true)

      dispose()
      await suite.flush()
    } finally {
      resetJsxRuntime()
    }
  })
})

test("keeps deferred S14b edges explicit", async () => {
  const rec = recording()
  const suite = initJsxRuntime(rec.send)
  const container = createElement("#root")

  try {
    const dispose = suite.render(
      () =>
        createComponent(
          select.Root,
          {
            value: "red",
            onValueChange: () => {},
            children: () => [
              createComponent(select.Trigger, { children: () => createTextNode("Color") }),
              createComponent(select.Content, {
                children: () => createComponent(select.Item, {
                  value: "red",
                  children: () => createTextNode("Red"),
                }),
              }),
            ],
          },
        ) as HostNode,
      container,
    )
    await suite.flush()

    const mutations = (): Mutation[] => rec.batches.flatMap((batch) => batch.mutations)
    const triggerId = rec.batches[0]?.mutations.find(
      (mutation): mutation is Extract<Mutation, { op: "setEventListener" }> =>
        mutation.op === "setEventListener" && mutation.eventType === "click",
    )?.id
    expect(triggerId).toBeDefined()
    expect(
      mutations().some(
        (mutation) =>
          mutation.op === "setEventListener" &&
          (mutation.eventType === "mouseDown" || mutation.eventType === "mouseUp"),
      ),
    ).toBe(false)

    // Outside-click dismissal and IME composition suppression are deliberate
    // deferred edges: there is no global pointer listener or composition event
    // in this protocol contract for S14b to consume.
    const protocolEvents = EVENT_TYPES as readonly string[]
    expect(protocolEvents).not.toContain("compositionStart")
    expect(protocolEvents).not.toContain("compositionEnd")

    if (triggerId === undefined) throw new Error("select trigger listener was not mounted")
    suite.handler(triggerId, "click")?.(event(triggerId, "click"))
    await suite.flush()

    const opened = mutations()
    const contentId = opened.find(
      (mutation): mutation is Extract<Mutation, { op: "setDeferred" }> =>
        mutation.op === "setDeferred" && mutation.deferred,
    )?.id
    expect(contentId).toBeDefined()
    if (contentId === undefined) throw new Error("select content was not deferred")
    expect(opened).toContainEqual(
      expect.objectContaining({ op: "setAnchored", id: contentId, anchor: "topLeft" }),
    )
    expect(opened).toContainEqual(
      expect.objectContaining({
        op: "setAccessibility",
        id: contentId,
        accessibility: expect.objectContaining({ role: "listbox" }),
      }),
    )

    dispose()
    await suite.flush()
  } finally {
    resetJsxRuntime()
  }
})

describe("combobox primitives", () => {
  test("uses an editable controlled input and opens on input", async () => {
    const rec = recording()
    const suite = initJsxRuntime(rec.send)
    const [value, setValue] = createSignal("")
    const changes: string[] = []
    const container = createElement("#root")

    try {
      const dispose = suite.render(
        () =>
          createComponent(combobox.Root, {
            get value() {
              return value()
            },
            onValueChange: (next: string) => {
              changes.push(next)
              setValue(next)
            },
            children: () => createComponent(combobox.Trigger, { placeholder: "Search" }),
          }) as HostNode,
        container,
      )
      await suite.flush()

      const inputId = rec.batches[0]?.mutations.find(
        (mutation): mutation is Extract<Mutation, { op: "createElement" }> =>
          mutation.op === "createElement" && mutation.elementType === "input",
      )?.id
      expect(inputId).toBeDefined()
      expect(
        rec.batches[0]?.mutations.some(
          (mutation) =>
            mutation.op === "setAccessibility" &&
            mutation.accessibility?.role === "combobox" &&
            mutation.accessibility.expanded === false,
        ),
      ).toBe(true)

      suite.handler(inputId!, "input")?.(event(inputId!, "input", { value: "blu" }))
      await suite.flush()

      expect(changes).toEqual(["blu"])
      expect(value()).toBe("blu")
      expect(
        rec.batches.flatMap((batch) => batch.mutations).some(
          (mutation) =>
            mutation.op === "setAccessibility" &&
            mutation.accessibility?.role === "combobox" &&
            mutation.accessibility.expanded === true &&
            mutation.accessibility.value === "blu",
        ),
      ).toBe(true)

      dispose()
      await suite.flush()
    } finally {
      resetJsxRuntime()
    }
  })
})
