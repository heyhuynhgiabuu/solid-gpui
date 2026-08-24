import { createSignal, For } from "solid-js"
import { createRenderer } from "@solidjs/universal"
const log: string[] = []
const R = createRenderer<any>({
  createElement: (t) => { const n = { t, i: Math.random() }; log.push(`create:${t}`); return n },
  createTextNode: (v) => ({ t: "#text", v }),
  replaceText: () => {},
  isTextNode: (n) => n.t === "#text",
  setProperty: () => {},
  insertNode: (p, n, a) => log.push(`insert ${n.t} into ${p.t}${a ? " before " + a.t : ""}`),
  removeNode: (_p, n) => log.push(`remove ${n.t}`),
  getParentNode: (n) => n.parent,
  getFirstChild: (n) => n.firstChild,
  getNextSibling: (n) => n.next,
})
const container: any = { t: "#root" }
const [items, setItems] = createSignal([1, 2, 3])
R.render(() => {
  const root: any = { t: "div" }
  R.insert(root, () => R.createComponent(For, { each: items, children: (item: any) => { console.log("ROW for", item); return { t: `row-${item}`, parent: root } } }))
  return root
}, container)
console.log("LOG1:", log.join(" | "))
setItems([3, 2, 1])
console.log("LOG2:", log.join(" | ").slice(log.join(" | ").indexOf("LOG1") + 4))
