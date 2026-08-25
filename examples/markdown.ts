/**
 * Markdown demo — S13 acceptance (`bun run example/markdown`).
 *
 * Renders a markdown document (headings, emphasis, inline code, links,
 * bare-URL autolinks, lists, blockquote, code fence, table, rule) in a
 * native GPUI window, with a button that swaps the document through the
 * reactive `source` prop (one setText per change — parsing/rendering is
 * entirely Rust-side).
 */
import { createSignal } from "solid-js"
import { render, type RenderHandle } from "../packages/solid/src/render"

const g = globalThis as { __markdownHandle?: RenderHandle }

const DOC_A = `# solid-gpui markdown 🎉

Rich text ported from **Comet** (MIT) — parsed by *pulldown-cmark*, rendered
natively by GPUI. Inline \`code\`, ~~strikethrough~~, and a
[link](https://github.com/heyhuynhgiabuu/solid-gpui). Bare URLs autolink too:
https://zed.dev

## Blocks

- unordered item
- with a \`code span\`
  - nested item

1. ordered one
2. ordered two

> quoted line with *emphasis*

\`\`\`rust
fn main() {
    println!("hello, markdown");
}
\`\`\`

| feature | status | origin |
|:--------|:------:|-------:|
| parser  | done   | Comet |
| render  | done   | Comet |
| syntax  | done   | S13e  |

---

Tail paragraph — click the button to swap documents.`

const DOC_B = `## Swapped! 🔄

This is a *second* document. The whole tree re-renders from ONE
\`setText\` mutation — no per-block JS↔Rust traffic.

\`\`\`ts
const md = h("markdown", { source: () => doc() })
\`\`\`

\`\`\`python
def greet(name: str) -> str:
    return f"hello, {name}!"
\`\`\`

\`\`\`yaml
name: solid-gpui
syntax: bundled
\`\`\`

- [x] mount
- [x] swap
- [x] syntax highlighting (S13e)`

function tree(h: Parameters<RenderHandle["update"]>[0]) {
  const [doc, setDoc] = createSignal(DOC_A)
  const [dark, setDark] = createSignal(true)
  const root = h(
    "div",
    {
      style: () => ({
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: dark() ? "#1e1e2e" : "#eff1f5",
        padding: 16,
      }),
    },
    h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          gap: 8,
          paddingBottom: 8,
        },
      },
      h(
        "div",
        {
          style: {
            padding: "6px 12px",
            borderRadius: 8,
            backgroundColor: dark() ? "#89b4fa" : "#45475a",
            color: "#1e1e2e",
            cursor: "pointer",
          },
          onClick: () => setDoc((d) => (d === DOC_A ? DOC_B : DOC_A)),
        },
        "swap document",
      ),
      h(
        "div",
        {
          style: {
            padding: "6px 12px",
            borderRadius: 8,
            backgroundColor: dark() ? "#45475a" : "#89b4fa",
            color: "#1e1e2e",
            cursor: "pointer",
          },
          onClick: () => setDark((v) => !v),
        },
        "toggle theme",
      ),
    ),
    h(
      "div",
      {
        style: () => ({
          overflow: "scroll",
          flexGrow: 1,
          flexShrink: 1,
          minHeight: 0,
        }),
      },
      h("markdown", {
        style: () => ({
          color: dark() ? "#cdd6f4" : "#4c4f69",
          fontSize: 14,
        }),
        source: () => doc(),
      }),
    ),
  )
  return root
}

if (!g.__markdownHandle) {
  g.__markdownHandle = await render((h) => tree(h))
  const mounted = g.__markdownHandle
  void mounted.connection.exited.then(() => {
    if (g.__markdownHandle === mounted) g.__markdownHandle = undefined
  })
  console.log("mounted (fresh helper) — click the buttons in the window; Ctrl+C here to exit")
  process.on("SIGINT", () => {
    const handle = g.__markdownHandle
    g.__markdownHandle = undefined
    if (!handle) process.exit(0)
    void Promise.race([
      handle.dispose().catch((err) => console.error("[solid-gpui] dispose failed:", err)),
      new Promise((r) => setTimeout(r, 3000)),
    ]).then(() => process.exit(0))
  })
} else {
  await g.__markdownHandle.update(tree)
  console.log("remounted (hot)")
}
