/**
 * Hyperscript authoring helper (v0.1): JSX compilation for Solid requires
 * babel-preset-solid/vite (generate: "universal"), which bun run does not
 * apply — h() is the runtime-authored equivalent.
 */
import type { HostNode } from "./renderer"
import type { Renderer } from "@solidjs/universal"
import type { StyleMap } from "@solid-gpui/protocol"

type Child = HostNode | string | number | null | undefined | (() => Child)

export interface H {
  (
    tag: string,
    props?: {
      /** Static bag, or a function of signals for a reactive bag. */
      style?: StyleMap | (() => StyleMap)
      onClick?: () => void
      [key: string]: unknown
    },
    ...children: Child[]
  ): HostNode
}

export function makeH(R: Renderer<HostNode>): H {
  return ((tag: string, props: Record<string, unknown> = {}, ...children: unknown[]) => {
    const el = R.createElement(tag)
    for (const [name, value] of Object.entries(props)) {
      if (name === "style" && typeof value === "function") {
        // Reactive style bag (compiled-JSX getter semantics): re-evaluated
        // in a render effect whenever its signals change, re-invoking
        // setProp with the SAME node — the renderer's style diff (and any
        // transitionMs animation) sees consecutive bags. h() reads every
        // other prop eagerly; without this wrap, style updates would never
        // re-flow at all. R.effect (not a direct solid-js import): the
        // renderer's own effect primitive shares the exact solid instance
        // that created the owners, so this runs under them — importing
        // solid-js separately once resolved a mismatched build and crashed
        // the reaction context ([REACTIVITY_HALTED]).
        let current: StyleMap | undefined
        R.effect(
          () => {
            // Compute reads the signals (tracked). It returns void on
            // purpose: rc.1's runner stores a non-function return in the
            // effect's cleanup slot and calls it on the next run
            // ([REACTIVITY_HALTED] crash); the commit reads via closure.
            current = (value as () => StyleMap)()
          },
          () => {
            if (current !== undefined) R.setProp(el, "style", current)
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
