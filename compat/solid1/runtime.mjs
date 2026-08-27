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

import { For, Match, Show, Switch, createMemo } from "solid-js"

let suite

export function init(next) {
  suite = next
}

function current() {
  if (!suite) throw new Error("Solid 1 runtime was not initialized")
  return suite.renderer
}

export function createElement(tag, props) {
  const node = current().createElement(tag)
  if (props) {
    for (const [name, value] of Object.entries(props)) current().setProp(node, name, value)
  }
  return node
}

export function createTextNode(value) {
  return current().createTextNode(value == null ? "" : String(value))
}

export function insertNode(parent, node, anchor) {
  current().insertNode(parent, node, anchor)
}

export function insert(parent, value, marker, initial) {
  // `null` is meaningful to Solid 1 universal: it selects the multi-child
  // insertion path. Converting it to `undefined` loses the input sibling.
  current().insert(parent, value, marker, initial)
}

export function removeNode(parent, node) {
  current().removeNode(parent, node)
}

export function setProp(node, name, value, prev) {
  return current().setProp(node, name, value, prev)
}

export function effect(fn, initValue) {
  // Solid 1's compiler emits one callback plus its mutable previous-value
  // object, unlike the split compute/commit callback used by the Solid 2
  // compiler. Preserve the optional initializer verbatim.
  return current().effect(fn, initValue)
}

export function createComponent(component, props) {
  return current().createComponent(component, props)
}

export function memo(fn) {
  return current().memo(fn, false)
}

export { For, Match, Show, Switch, createMemo }
