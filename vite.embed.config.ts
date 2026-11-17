// role: builds the embed bundle and the instruction document a chat model reads by address.
import { defineConfig } from "vite";

import { canvasPrompt, EMBED_SCRIPT_URL } from "./src/web/lib/prompt";

const PROMPT_DOCUMENT = `# elecuit 회로도 지침

사용자가 이 문서의 주소를 주면서 회로도를 그리라고 하면, 그 대화가 끝날 때까지 아래 지침을 따릅니다.

적용하라는 요청에는 "알겠습니다. 앞으로 이 형식으로 회로도를 그리겠습니다."처럼 한두 문장으로만 답합니다. 이 문서의 규칙, 템플릿, elecuit의 동작 방식을 요약하거나 설명하지 않고, 회로도도 사용자가 회로를 물을 때 그립니다.

${canvasPrompt(EMBED_SCRIPT_URL)}
`;

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
        this.emitFile({ type: "asset", fileName: "prompt.md", source: PROMPT_DOCUMENT });
      },
    },
  ],
});
