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

import { unlink, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { transformSync } from "@babel/core"
import { spawnHelper } from "../../packages/client/src/index.ts"
import solidPreset from "babel-preset-solid"
import { For, batch, createEffect, createRoot, createSignal, onCleanup } from "solid-js"
import { createRenderer } from "solid-js/universal"
import { init as initCompiledRuntime } from "./runtime.mjs"

const root = fileURLToPath(new URL("../../", import.meta.url))
const helperPath = process.env.SOLID_GPUI_HELPER ?? `${root}target/debug/solid-gpui-helper`

class HelperPipe {
  #connection

  constructor() {
    this.#connection = spawnHelper({ binary: helperPath, mode: "transport" })
  }

  async send(batch) {
    const ack = await this.#connection.sendBatch(batch)
    assert(ack.seq === batch.seq, `unexpected client ack seq=${ack.seq} expected=${batch.seq}`)
    assert(ack.applied === batch.mutations.length, `unexpected client applied=${ack.applied}`)
    return ack
  }

  async close() {
    await this.#connection.close()
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function makeSuite(send) {
  let nextId = 0
  let nextSeq = 0
  let rootNode = null
  const queue = []
  const batches = []
  const nodes = new Map()
  const handlers = new Map()

  function makeNode(kind, tag = "") {
    const node = { kind, tag, id: ++nextId, parent: null, children: [] }
    nodes.set(node.id, node)
    return node
  }

  function enqueue(mutation) {
    queue.push(mutation)
  }

  const renderer = createRenderer({
    createElement(tag) {
      const node = makeNode("element", tag)
      if (tag !== "#root") {
        const elementType =
          tag === "input" ? "input" : tag === "textarea" ? "textarea" : tag === "text" ? "text" : "div"
        enqueue({ op: "createElement", id: node.id, elementType })
      }
      return node
    },
    createTextNode(value) {
      const node = makeNode("text", "#text")
      enqueue({ op: "createElement", id: node.id, elementType: "text" })
      enqueue({ op: "setText", id: node.id, text: String(value) })
      return node
    },
    replaceText(node, value) {
      enqueue({ op: "setText", id: node.id, text: String(value) })
    },
    isTextNode(node) {
      return node.kind === "text"
    },
    setProperty(node, name, value) {
      if (name === "onClick" || name === "onInput" || name === "onChange") {
        const eventType = name === "onClick" ? "click" : name === "onInput" ? "input" : "change"
        const key = `${node.id}:${eventType}`
        if (typeof value === "function") handlers.set(key, value)
        else handlers.delete(key)
        enqueue({ op: "setEventListener", id: node.id, eventType, enabled: typeof value === "function" })
        return
      }
      if (name === "value" && (node.tag === "input" || node.tag === "textarea")) {
        enqueue({ op: "setValue", id: node.id, value: value == null ? "" : String(value) })
        return
      }
      if (name !== "children") throw new Error(`unsupported probe property: ${name}`)
    },
    insertNode(parent, node, anchor) {
      if (node.parent) {
        const oldIndex = node.parent.children.indexOf(node)
        if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1)
      }
      if (parent.kind === "container") {
        if (rootNode && rootNode !== node) enqueue({ op: "destroyElement", id: rootNode.id })
        parent.children = [node]
        node.parent = parent
        rootNode = node
        enqueue({ op: "setRoot", id: node.id })
        return
      }
      const index = anchor ? parent.children.indexOf(anchor) : parent.children.length
      const insertAt = index >= 0 ? index : parent.children.length
      parent.children.splice(insertAt, 0, node)
      node.parent = parent
      if (anchor && index >= 0) {
        enqueue({ op: "insertBefore", parentId: parent.id, childId: node.id, beforeId: anchor.id })
      } else {
        enqueue({ op: "appendChild", parentId: parent.id, childId: node.id })
      }
    },
    removeNode(parent, node) {
      const index = parent.children.indexOf(node)
      if (index >= 0) parent.children.splice(index, 1)
      node.parent = null
      if (parent.kind !== "container") {
        enqueue({ op: "removeChild", parentId: parent.id, childId: node.id })
      }
    },
    getParentNode(node) {
      return node.parent
    },
    getFirstChild(node) {
      return node.children[0]
    },
    getNextSibling(node) {
      if (!node.parent) return undefined
      return node.parent.children[node.parent.children.indexOf(node) + 1]
    },
  })

  async function flush() {
    for (let round = 0; round < 10; round++) {
      await Promise.resolve()
      if (queue.length === 0) {
        await Promise.resolve()
        if (queue.length === 0) return
      }
      const batch = { v: 1, seq: ++nextSeq, mutations: queue.splice(0) }
      await send(batch)
      batches.push(batch)
    }
    throw new Error("Solid 1 probe did not settle")
  }

  function disposeTree(dispose) {
    dispose()
    if (rootNode) {
      const rootId = rootNode.id
      const parent = rootNode.parent
      if (parent) {
        const index = parent.children.indexOf(rootNode)
        if (index >= 0) parent.children.splice(index, 1)
      }
      const remove = (node) => {
        for (const child of [...node.children]) remove(child)
        nodes.delete(node.id)
        handlers.delete(`${node.id}:click`)
        handlers.delete(`${node.id}:input`)
        handlers.delete(`${node.id}:change`)
      }
      remove(rootNode)
      rootNode = null
      enqueue({ op: "destroyElement", id: rootId })
    }
  }

  function fire(node, eventType, event) {
    const handler = handlers.get(`${node.id}:${eventType}`)
    assert(handler !== undefined, `no ${eventType} handler for node ${node.id}`)
    handler(event)
  }

  return {
    renderer,
    batches,
    nodes,
    flush,
    disposeTree,
    fire,
    container: makeNode("container", "#root"),
  }
}

async function runLifecycle(suite) {
  const cycles = []
  for (let cycle = 0; cycle < 3; cycle++) {
    const [value, setValue] = createSignal(cycle)
    let cleanups = 0
    const before = suite.batches.length
    const dispose = suite.renderer.render(() => {
      const rootNode = suite.renderer.createElement("div")
      suite.renderer.insert(rootNode, () => `cycle:${value()}`)
      onCleanup(() => cleanups++)
      return rootNode
    }, suite.container)
    await suite.flush()
    const mounted = suite.batches.length - before
    setValue(cycle + 1)
    await suite.flush()
    const updated = suite.batches.length - before - mounted
    suite.disposeTree(dispose)
    await suite.flush()
    const destroyed = suite.batches.length - before - mounted - updated
    setValue(cycle + 2)
    await suite.flush()
    assert(cleanups === 1, `cycle ${cycle} cleanup count=${cleanups}`)
    assert(suite.nodes.size === 1, `cycle ${cycle} retained ${suite.nodes.size - 1} nodes`)
    cycles.push({ cycle, mounted, updated, destroyed })
  }
  assert(
    cycles.every((cycle) => cycle.mounted === 1 && cycle.updated === 1 && cycle.destroyed === 1),
    "unexpected lifecycle batch counts",
  )
  return cycles
}

async function runKeyedReorder(suite) {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }]
  const [list, setList] = createSignal(items)
  const itemNodes = new Map()
  const dispose = suite.renderer.render(() => {
    const rootNode = suite.renderer.createElement("div")
    suite.renderer.insert(rootNode, () =>
      suite.renderer.createComponent(For, {
        get each() {
          return list()
        },
        children: (item) => {
          const row = suite.renderer.createElement("div")
          itemNodes.set(item.id, row)
          suite.renderer.insert(row, item.id)
          return row
        },
      }),
    )
    return rootNode
  }, suite.container)
  await suite.flush()
  const initial = suite.container.children[0].children.map((node) => node.id)
  const updateBatch = suite.batches.length
  setList([items[2], items[0], items[1]])
  await suite.flush()
  const reordered = suite.container.children[0].children.map((node) => node.id)
  const expected = [itemNodes.get("c"), itemNodes.get("a"), itemNodes.get("b")].map((node) => node.id)
  assert(JSON.stringify(reordered) === JSON.stringify(expected), `keyed reorder ids=${reordered} expected=${expected}`)
  const mutations = suite.batches.slice(updateBatch).flatMap((batch) => batch.mutations)
  assert(!mutations.some((mutation) => mutation.op === "createElement"), "keyed reorder recreated a row")
  assert(mutations.some((mutation) => mutation.op === "insertBefore"), "keyed reorder emitted no move")
  suite.disposeTree(dispose)
  await suite.flush()
  return { initial, reordered, updateOps: mutations.map((mutation) => mutation.op) }
}

async function runCompiledInput(suite) {
  const source = `
    export default function App(props) {
      return <div><input value={props.value} onInput={props.onInput} />{props.value}</div>;
    }
  `
  const transformed = transformSync(source, {
    filename: "solid1-compat-probe.tsx",
    presets: [[solidPreset, { generate: "universal", moduleName: "./runtime.mjs" }]],
  })
  const generated = transformed?.code ?? ""
  assert(generated.includes("_$effect"), "Solid 1 compiler did not emit universal effect")
  assert(generated.includes("_$insert"), "Solid 1 compiler did not emit universal insert")
  assert(generated.includes("e: undefined"), "Solid 1 compiler did not emit a previous-value initializer")
  const outputPath = new URL("./compiled-app.mjs", import.meta.url)
  await writeFile(outputPath, `${generated}\n`)
  try {
    initCompiledRuntime(suite)
    const { default: App } = await import(`${outputPath.href}?run=${Date.now()}`)
    const [value, setValue] = createSignal("alpha")
    let event
    const before = suite.batches.length
    const props = {
      get value() {
        return value()
      },
      onInput: (next) => {
        event = next
        setValue(next.value)
      },
    }
    const dispose = suite.renderer.render(() => App(props), suite.container)
    await suite.flush()
    const input = suite.container.children[0].children[0]
    suite.fire(input, "input", { type: "event", id: input.id, eventType: "input", value: "beta" })
    await suite.flush()
    assert(event?.value === "beta", "compiled onInput handler did not receive the event")
    assert(value() === "beta", `compiled handler did not update signal: ${value()}`)
    const mutations = suite.batches.slice(before).flatMap((batch) => batch.mutations)
    assert(
      mutations.some((mutation) => mutation.op === "setEventListener" && mutation.eventType === "input"),
      "input listener did not cross adapter",
    )
    assert(
      mutations.some((mutation) => mutation.op === "setValue" && mutation.value === "beta"),
      "controlled input value did not cross adapter",
    )
    assert(
      mutations.some((mutation) => mutation.op === "setText" && mutation.text === "beta"),
      "dependent text did not update",
    )
    suite.disposeTree(dispose)
    await suite.flush()
    return {
      compiler: "babel-preset-solid@1.9.15",
      generatedBytes: generated.length,
      effectForm: "single-callback-with-previous-value-initializer",
      updateOps: mutations.map((mutation) => mutation.op),
    }
  } finally {
    await unlink(outputPath).catch(() => {})
  }
}

async function runEffectAndBatch() {
  const [value, setValue] = createSignal(0)
  let effectRuns = 0
  let cleanups = 0
  const dispose = createRoot((disposeRoot) => {
    createEffect(() => {
      value()
      effectRuns++
      onCleanup(() => cleanups++)
    })
    return disposeRoot
  })
  assert(effectRuns === 1, `Solid 1 user effect did not run during root initialization: ${effectRuns}`)
  batch(() => {
    setValue(1)
    setValue(2)
  })
  assert(effectRuns === 2, `Solid 1 batch produced ${effectRuns - 1} effect updates`)
  assert(cleanups === 1, `Solid 1 effect cleanup count before dispose=${cleanups}`)
  dispose()
  assert(cleanups === 2, `Solid 1 effect cleanup count after dispose=${cleanups}`)
  return { initialEffectRuns: 1, batchedEffectUpdates: 1, cleanups: 2 }
}

const pipe = new HelperPipe()
const suite = makeSuite((batch) => pipe.send(batch))
let result
try {
  result = {
    schema: "solid-gpui-solid1-compat/v1",
    versions: {
      solid: "1.9.15",
      compiler: "babel-preset-solid@1.9.15",
      universal: "solid-js/universal@1.9.15",
    },
    conditions: "browser",
    boundary: "@solid-gpui/client -> helper --stdio",
    lifecycle: await runLifecycle(suite),
    keyedReorder: await runKeyedReorder(suite),
    effectAndBatch: await runEffectAndBatch(),
    compiledInput: await runCompiledInput(suite),
    acknowledgements: suite.batches.length,
  }
} finally {
  await pipe.close()
}
console.log("SOLID1_COMPATIBILITY_BENCHMARK")
console.log(JSON.stringify(result, null, 2))
