// role: builds the embed bundle, one script that draws netlist blocks inside any host page.
import { defineConfig } from "vite";

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
});
