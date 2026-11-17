// role: builds the browser app into one self-contained HTML file.
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "src/web",
  build: { outDir: "../../dist", emptyOutDir: true },
  plugins: [viteSingleFile()],
});
