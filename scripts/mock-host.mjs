#!/usr/bin/env bun
/*
 * Copyright 2026 the solid-gpui authors
 *
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
 * Mock host: a JS implementation of the solid-gpui wire protocol that
 * applies batches to an in-memory mirror and prints the tree instead of
 * painting. Develop components and exercise events with NO Rust toolchain.
 *
 * Inspired by the mock-host idea in lxsmnsyc/solid-gpui (MIT); this
 * implementation speaks OUR protocol and validates input through
 * @solid-gpui/protocol's own decoders, so the mock is protocol-faithful by
 * construction.
 *
 * Usage (the shebang makes the file directly spawnable, like a real helper):
 *   chmod +x scripts/mock-host.mjs
 *   SOLID_GPUI_HELPER=$PWD/scripts/mock-host.mjs bun --conditions=browser run app.ts
 *   SOLID_GPUI_MOCK_DUMP=1   print the tree to stderr after every batch
 *   SOLID_GPUI_MOCK_CLICK=7  emit a click event for node 7 once it exists
 *
 * The client prepends a mode flag (--stdio / --stdio-window) as argv[2];
 * the mock ignores argv and answers in both modes.
 */
import { createInterface } from "node:readline"
import { decodeBatch, decodeCommand } from "@solid-gpui/protocol"

/** id → { elementType, parent, children: number[], text, listeners: string[] } */
const mirror = new Map()
let root = null
const mockClickId = Number(process.env.SOLID_GPUI_MOCK_CLICK ?? Number.NaN)
let mockClickFired = false
const wantDump = process.env.SOLID_GPUI_MOCK_DUMP === "1"
const version = "0.1.0-mock"
// The wire major; the Rust crate (crates/protocol) is the source of truth.
const PROTOCOL_VERSION = 1

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

function apply(mutation) {
  const op = mutation.op
  const id = mutation.id
  switch (op) {
    case "createElement":
      mirror.set(id, { elementType: mutation.elementType, parent: null, children: [], text: null, listeners: [] })
      break
    case "destroyElement": {
      const node = mirror.get(id)
      if (node?.parent != null) {
        const parent = mirror.get(node.parent)
        if (parent) parent.children = parent.children.filter((c) => c !== id)
      }
      const kill = (nid) => {
        const n = mirror.get(nid)
        if (n) for (const c of n.children) kill(c)
        mirror.delete(nid)
      }
      kill(id)
      break
    }
    case "appendChild":
    case "insertBefore": {
      const parentId = mutation.parentId
      const parent = mirror.get(parentId)
      if (!parent) throw new Error(`${op}: missing parent ${parentId}`)
      const child = mirror.get(mutation.childId)
      if (child) {
        if (child.parent != null) {
          const old = mirror.get(child.parent)
          if (old) old.children = old.children.filter((c) => c !== mutation.childId)
        }
        child.parent = parentId
        if (op === "appendChild") parent.children.push(mutation.childId)
        else {
          const anchor = mutation.beforeId ?? null
          const at = anchor == null ? parent.children.length : parent.children.indexOf(anchor)
          parent.children.splice(at < 0 ? parent.children.length : at, 0, mutation.childId)
        }
      }
      break
    }
    case "removeChild": {
      const parent = mirror.get(mutation.parentId)
      if (parent) parent.children = parent.children.filter((c) => c !== mutation.childId)
      const child = mirror.get(mutation.childId)
      if (child) child.parent = null
      break
    }
    case "setRoot":
      root = id
      break
    case "setText":
    case "setTextRuns":
      if (mirror.has(id)) mirror.get(id).text = mutation.text ?? null
      break
    case "setEventListener":
      if (mirror.has(id) && mutation.enabled) {
        const listeners = mirror.get(id).listeners
        if (!listeners.includes(mutation.eventType)) listeners.push(mutation.eventType)
      }
      break
    default:
      // setStyle/setSrc/setValue/setTooltip/setAccessibility/setAnimation/
      // setKeyBindings/setDeferred/setAnchored/setDrawList/setDragData:
      // shape-debugging host ignores render-only state.
      break
  }
}

function nodeValue(id, count) {
  count.n += 1
  const node = mirror.get(id)
  if (!node) return { id, missing: true }
  return {
    id,
    type: node.elementType,
    parent: node.parent,
    children: node.children.map((c) => nodeValue(c, count)),
    ...(node.text != null ? { text: node.text } : {}),
  }
}

function dumpTree() {
  const count = { n: 0 }
  const rootNode = root == null ? null : nodeValue(root, count)
  return { root: rootNode, count: count.n }
}

function handleCommand(cmd) {
  switch (cmd.type) {
    case "getStats":
      emit({
        type: "result",
        seq: cmd.seq,
        value: {
          helperVersion: version,
          protocolVersion: PROTOCOL_VERSION,
          frames: null,
          mock: true,
        },
      })
      break
    case "dumpTree":
      emit({ type: "result", seq: cmd.seq, value: dumpTree() })
      break
    case "resetTree":
      mirror.clear()
      root = null
      emit({ type: "result", seq: cmd.seq, value: { applied: true } })
      break
    default:
      emit({
        type: "error",
        seq: cmd.seq ?? null,
        code: "unsupported",
        message: `${cmd.type} requires the real GPUI helper; the mock host draws nothing`,
      })
  }
}

function maybeMockClick() {
  if (mockClickFired || !Number.isFinite(mockClickId)) return
  const node = mirror.get(mockClickId)
  if (node?.listeners.includes("click")) {
    mockClickFired = true
    emit({ type: "event", id: mockClickId, eventType: "click" })
  }
}

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log("mock host: speaks the solid-gpui protocol, draws nothing")
  process.exit(0)
}

const rl = createInterface({ input: process.stdin })
rl.on("close", () => {
  // EOF is the client's quit signal: exit 0 like the real helper does.
  process.exit(0)
})
rl.on("line", (line) => {
  if (!line.trim()) return
  // One dispatch: batches are the common case, commands decline first.
  const batch = decodeBatch(line)
  if (batch.ok) {
    for (const mutation of batch.value.mutations) {
      try {
        apply(mutation)
      } catch (err) {
        emit({ type: "error", seq: batch.value.seq, code: "applyFailed", message: String(err) })
        return
      }
    }
    emit({ type: "ack", seq: batch.value.seq, applied: batch.value.mutations.length })
    if (wantDump) {
      process.stderr.write(`${JSON.stringify(dumpTree())}\n`)
    }
    maybeMockClick()
    return
  }
  const cmd = decodeCommand(line)
  if (cmd.ok) {
    handleCommand(cmd.value)
    return
  }
  emit({ type: "error", seq: null, code: "decodeFailed", message: batch.error.message })
})
