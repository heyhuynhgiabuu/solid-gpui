/**
 * Bun preload plugin: compile .tsx through babel-preset-solid
 * { generate: "universal", moduleName: "@solid-gpui/solid/jsx" }.
 *
 * Usage (dev DX — no bundler config needed):
 *   bun --conditions=browser --preload ./scripts/solid-jsx-preload.ts run examples/counter.tsx
 */
import { transformSync } from "@babel/core"
import preset from "babel-preset-solid"

await Bun.plugin({
  name: "solid-gpui-jsx",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const source = await Bun.file(args.path).text()
      const out = transformSync(source, {
        filename: args.path,
        presets: [
          [preset, { moduleName: "@solid-gpui/solid/jsx", generate: "universal" }],
        ],
        parserOpts: { plugins: ["jsx", "typescript"] },
      })
      const contents = out.code ?? ""
      return { contents, loader: "ts" }
    })
  },
})
