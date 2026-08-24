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
      style?: StyleMap
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
      R.setProp(el, name, value)
    }
    for (const child of children) {
      R.insert(el, (typeof child === "function" ? child : () => child) as () => unknown, undefined, undefined)
    }
    return el
  }) as H
}
