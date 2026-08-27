import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    jsx: "src/jsx.ts",
    "jsx-runtime": "src/jsx-runtime.ts",
    "jsx-dev-runtime": "src/jsx-dev-runtime.ts",
  },
  outDir: "dist",
  format: "esm",
  dts: true,
  clean: true,
  target: "node20",
})
