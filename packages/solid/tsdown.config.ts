import { defineConfig } from "tsdown"

export default defineConfig({
  entry: { index: "src/index.ts", jsx: "src/jsx.ts" },
  outDir: "dist",
  format: "esm",
  dts: true,
  clean: true,
  target: "node20",
})
