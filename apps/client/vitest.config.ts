import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Tests always run against the default shell so they describe the repository's own behaviour.
const defaultShell = (file: string) => fileURLToPath(new URL(`./src/shell/default/${file}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: /^@shell$/, replacement: defaultShell("index.jsx") },
      { find: /^@shell\/(.*)$/, replacement: defaultShell("$1") },
      { find: "@forge-cb/api", replacement: fileURLToPath(new URL("../../packages/api/src/index.ts", import.meta.url)) },
      { find: "@forge-cb/engine/browser", replacement: fileURLToPath(new URL("../../packages/engine/src/browser.ts", import.meta.url)) },
      { find: "@forge-cb/engine/sheet-contract", replacement: fileURLToPath(new URL("../../packages/engine/src/sheet/template-contract.ts", import.meta.url)) },
      { find: "@forge-cb/engine", replacement: fileURLToPath(new URL("../../packages/engine/src/index.ts", import.meta.url)) },
    ],
  },
  test: {
    include: ["src/**/*.test.{js,jsx,ts,tsx}", "config/**/*.test.{js,mjs,ts}"],
    environment: "node",
  },
});
