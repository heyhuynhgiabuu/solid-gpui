/**
 * Hyperscript authoring helper (v0.1): JSX compilation for Solid uses
 * @solidjs/babel-plugin (generate: "universal"); h() is the runtime-authored
 * equivalent for code paths that do not run through the compiler.
 */
import type { HostNode } from "./renderer"
import type { Renderer } from "@solidjs/universal"
import type { StyleMap, TextRun } from "@solid-gpui/protocol"

type Child = HostNode | string | number | null | undefined | (() => Child)

export interface H {
  (
    tag: string,
    props?: {
      /** Static bag, or a function of signals for a reactive bag. */
      style?: StyleMap | (() => StyleMap)
      runs?: TextRun[] | (() => TextRun[])
      onClick?: () => void
      [key: string]: unknown
    },
    ...children: Child[]
  ): HostNode
}

export function makeH(R: Renderer<HostNode>): H {
  return ((tag: string, rawProps?: Record<string, unknown> | null, ...children: unknown[]) => {
    // `= {}` alone does not cover an explicit null (Object.entries throws).
    const props: Record<string, unknown> = rawProps ?? {}
    const el = R.createElement(tag)
    for (const [name, value] of Object.entries(props)) {
      if (
        (name === "style" || name === "source" || name === "runs") &&
        typeof value === "function"
      ) {
        // Reactive style bag, markdown source, or text runs (compiled-JSX
        // getter semantics): re-evaluated in a render effect whenever its signals
        // change, re-invoking setProp with the SAME node — the renderer sees
        // consecutive values. h() reads every other prop eagerly; without
        // this wrap, updates would never re-flow at all. R.effect (not a
        // direct solid-js import): the renderer's own effect primitive
        // shares the exact solid instance that created the owners, so this
        // runs under them — importing solid-js separately once resolved a
        // mismatched build and crashed the reaction context
        // ([REACTIVITY_HALTED]).
        let current: StyleMap | string | TextRun[] | undefined
        R.effect(
          () => {
            // Compute reads the signals (tracked). It returns void on
            // purpose: older Solid 2 runners stored a non-function return in the
            // effect's cleanup slot and calls it on the next run
            // ([REACTIVITY_HALTED] crash); the commit reads via closure.
            current = (value as () => StyleMap | string | TextRun[])()
          },
          () => {
            if (current !== undefined) R.setProp(el, name, current)
          },
        )
        continue
      }
      R.setProp(el, name, value)
    }
    for (const child of children) {
      R.insert(el, (typeof child === "function" ? child : () => child) as () => unknown, undefined, undefined)
    }
    return el
  }) as H
}
