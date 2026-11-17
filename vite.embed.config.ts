// role: builds the embed bundle and the instruction document a chat model reads by address.
import { defineConfig } from "vite";

import { promptDocument } from "./src/web/lib/prompt";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/web/embed.ts",
      formats: ["iife"],
      name: "elecuit",
      fileName: () => "elecuit.js",
    },
  },
  plugins: [
    {
      name: "elecuit-prompt-document",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "prompt.md", source: promptDocument() });
      },
    },
  ],
});
