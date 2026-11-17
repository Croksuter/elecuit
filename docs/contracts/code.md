# 코드 값

## 도구

- **1.** 포매터는 prettier이고 설정은 `.prettierrc.json`(hy-code-style 기본값)이다. `npm run format`으로 적용하고 `npm run check`로 확인한다. (created by discussions/2026-11-17-elecuit-start.md#결정)
- **2.** 빌드는 Vite와 `vite-plugin-singlefile`로 `dist/index.html` 한 파일을 만든다. (created by discussions/2026-11-17-elecuit-start.md#결정)

## 구조

- **3.** 브라우저 앱은 `src/web`에 있고 React 없이 TypeScript로 쓴다. 순수 로직(파서, 검사, 배치, 렌더 문자열)은 `src/web/lib`, 화면 연결은 `src/web/main.ts`에 둔다. (created by discussions/2026-11-17-elecuit-start.md#결정)
- **4.** 임베드 번들은 `vite.embed.config.ts`로 `dist/elecuit.js`(IIFE) 한 파일을 만든다. 진입점은 `src/web/embed.ts`이고, 페이지와 임베드가 함께 쓰는 브라우저 쪽 그리기 코드는 `src/web/schematic.ts`와 `src/web/schematic.css`에 둔다. (created by discussions/2026-11-17-elecuit-start.md#결정-1)
- **5.** `demo/embed.html`은 빌드한 임베드 번들을 로컬에서 열어 보는 정적 파일이다. (created by discussions/2026-11-17-elecuit-start.md#결정-1)
- ~~**6.** `dist/elecuit.js`만 git에 넣는다. jsDelivr가 GitHub 저장소 `Croksuter/elecuit`의 태그에서 이 파일을 서빙하기 때문이고, 태그는 `v` 없이 `0.1.0` 꼴로 단다. 템플릿 주소는 `src/web/lib/prompt.ts`의 `EMBED_SCRIPT_URL`이다.~~ (created by discussions/2026-11-17-security.md#질문) (changed to #8)
- ~~**7.** 릴리스는 `package.json`의 `version`을 올리고, `npm run build`로 번들을 다시 만들어 커밋한 뒤, version과 같은 이름의 태그를 단다. `EMBED_SCRIPT_URL`이 이 version을 그대로 쓴다.~~ (created by discussions/2026-11-17-security.md#2026-11-17-주소-고정) (changed to #9)
- **8.** `dist`에서는 `elecuit.js`와 `prompt.md`만 git에 넣는다. jsDelivr가 GitHub 저장소 `Croksuter/elecuit`의 태그에서 이 파일들을 서빙하기 때문이고, 태그는 `v` 없이 `0.1.0` 꼴로 단다. `prompt.md`는 `vite.embed.config.ts`가 `canvasPrompt(EMBED_SCRIPT_URL)`로 만든다. (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-지침-문서-배포) (changed from #6)
- **9.** 릴리스는 `npm version <새 버전> --no-git-tag-version`으로 version을 올리고, `README.md`의 주소를 같은 version으로 고치고, `npm run build`로 `dist`를 다시 만들어 커밋한 뒤, version과 같은 이름의 태그를 단다. (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-지침-문서-배포) (changed from #7)
- **10.** 릴리스를 푸시한 뒤 `curl https://purge.jsdelivr.net/gh/Croksuter/elecuit@latest/dist/prompt.md`로 최신 주소의 캐시를 비우고, `@latest` 문서의 `버전:` 줄이 새 version인지 확인한다. (created by discussions/2026-11-17-security.md#2026-11-17-릴리스-뒤-최신-주소-갱신)
- **11.** 임베드에서 한 묶음의 열 수와 공통 배율을 정하는 계산은 `src/web/lib/arrange.ts`에 두고, 묶음을 나누고 격자를 적용하는 DOM 코드는 `src/web/embed.ts`에 둔다. (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-여러-회로-배치)
