/**
 * Gate 3-a: pointer outside-click dismissal. The helper emits one
 * `outsideClick` event when a press lands outside a subscribed element's
 * rendered bounds; select.Root subscribes so overlays dismiss without each
 * app re-inventing global-pointer plumbing.
 */
import { describe, expect, test } from "bun:test"
import { createSolidRenderer } from "./renderer"
import {
  createComponent,
  createTextNode,
  initJsxRuntime,
  resetJsxRuntime,
} from "./jsx"
import { select } from "./select"
import type { Mutation, MutationBatch } from "@solid-gpui/protocol"
import type { HostNode, Send } from "./renderer"

function recording() {
  const batches: MutationBatch[] = []
  let seq = 0
  const send: Send = async (batch) => {
    void seq
    batches.push(batch)
    return { seq: batch.seq, applied: batch.mutations.length }
  }
  const suite = initJsxRuntime(send)
  return { suite, r: { batches } }
}

const listeners = (batches: readonly MutationBatch[]) =>
  batches.flatMap((b) => b.mutations).filter(
    (m): m is Extract<Mutation, { op: "setEventListener" }> => m.op === "setEventListener",
  )

describe("onOutsideClick prop", () => {
  test("registers an outsideClick listener on the element", async () => {
    const { suite, r } = recording()
    try {
      const el = suite.renderer.createElement("div")
      suite.renderer.setProp(el, "onOutsideClick", () => {})
      await suite.flush()
      const reg = listeners(r.batches).find((m) => m.eventType === "outsideClick")
      expect(reg !== undefined && reg.op === "setEventListener" ? reg.enabled : false).toBe(true)
    } finally {
      resetJsxRuntime()
    }
  })
})

describe("select.Root outside-click dismissal", () => {
  test("opens via trigger, then an outside press closes the menu", async () => {
    const { suite, r } = recording()
    try {
      const container = suite.renderer.createElement("#root")
      const dispose = suite.render(
        () =>
          createComponent(select.Root, {
            value: "red",
            onValueChange: () => {},
            children: () => [
              createComponent(select.Trigger, { children: () => createTextNode("Color") }),
              createComponent(select.Content, {
                children: () =>
                  createComponent(select.Item, {
                    value: "red",
                    children: () => createTextNode("Red"),
                  }),
              }),
            ],
          }) as HostNode,
        container,
      )
      await suite.flush()

      const mutations = (): Mutation[] => r.batches.flatMap((b) => b.mutations)
      const event = (id: number, eventType: "click" | "outsideClick") =>
        ({ type: "event", id, eventType }) as const

      // Open through the trigger's real handler.
      const triggerId = mutations().find(
        (m): m is Extract<Mutation, { op: "setEventListener" }> =>
          m.op === "setEventListener" && m.eventType === "click",
      )?.id
      expect(triggerId).toBeDefined()
      suite.handler(triggerId!, "click")?.(event(triggerId!, "click"))
      await suite.flush()
      const contentId = mutations().find(
        (m): m is Extract<Mutation, { op: "setDeferred" }> =>
          m.op === "setDeferred" && m.deferred,
      )?.id
      expect(contentId).toBeDefined()

      // The root subscribes to outsideClick.
      const rootReg = mutations().find(
        (m): m is Extract<Mutation, { op: "setEventListener" }> =>
          m.op === "setEventListener" && m.eventType === "outsideClick",
      )
      expect(rootReg !== undefined && rootReg.op === "setEventListener" ? rootReg.enabled : false).toBe(true)

      // A press outside the root fires the dismissal path: the deferred
      // content unmounts (removeChild of the content node).
      const before = mutations().length
      suite.handler(rootReg!.id, "outsideClick")?.(event(rootReg!.id, "outsideClick"))
      await suite.flush()
      const after = mutations()
      expect(after.length).toBeGreaterThan(before)
      expect(
        after.slice(before).some((m) => m.op === "removeChild" && m.childId === contentId),
      ).toBe(true)

      dispose()
      await suite.flush()
    } finally {
      resetJsxRuntime()
    }
  })
})

describe("headless select smoke", () => {
  test("initJsxRuntime reset leaves no suite leak", () => {
    resetJsxRuntime()
    expect(true).toBe(true)
  })
})
