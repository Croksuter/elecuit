# 코드 값

## 도구

- **1.** 포매터는 prettier이고 설정은 `.prettierrc.json`(hy-code-style 기본값)이다. `npm run format`으로 적용하고 `npm run check`로 확인한다. (created by discussions/2026-11-17-elecuit-start.md#결정)
- **2.** 빌드는 Vite와 `vite-plugin-singlefile`로 `dist/index.html` 한 파일을 만든다. (created by discussions/2026-11-17-elecuit-start.md#결정)

## 구조

- **3.** 브라우저 앱은 `src/web`에 있고 React 없이 TypeScript로 쓴다. 순수 로직(파서, 검사, 배치, 렌더 문자열)은 `src/web/lib`, 화면 연결은 `src/web/main.ts`에 둔다. (created by discussions/2026-11-17-elecuit-start.md#결정)
