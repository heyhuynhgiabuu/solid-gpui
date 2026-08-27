/** @jsxImportSource @solid-gpui/solid */
import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import type { JSX } from "@solid-gpui/solid/jsx-runtime"
import { select } from "@solid-gpui/solid"

export interface Gate3Screen {
  readonly screen: JSX.Element
  readonly value: Accessor<string>
  readonly status: Accessor<string>
}

export function buildScreen(): Gate3Screen {
  const [value, setValue] = createSignal("red")
  const [status, setStatus] = createSignal("closed")

  const screen: JSX.Element = (
    <div style={{ padding: 16, flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 700 }}>Gate 3 overlay evidence</div>
      <select.Root
        value={value()}
        onValueChange={(next) => {
          setValue(next)
          setStatus(`selected ${next}`)
        }}
        onOpenChange={(open) => {
          if (open) setStatus("open")
        }}
      >
        <select.Trigger>{value()}</select.Trigger>
        <select.Content style={{ width: 160 }}>
          <select.Item value="red" label="Red" />
          <select.Item value="green" label="Green" />
          <select.Item value="blue" label="Blue" />
        </select.Content>
      </select.Root>
      <div>{`status: ${status()} | value: ${value()}`}</div>
    </div>
  )
  return { screen, value, status }
}
