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
- **12.** 배치는 `src/web/lib`의 파일 여섯으로 나눈다. `drawing.ts`(그리기 요소와 겹침 검사), `symbols.ts`(소자 기호), `network.ts`(이어진 소자 묶음의 배치), `blocks.ts`(게이트·증폭기·상자), `place.ts`(묶음과 블록을 열에 놓고 선 긋기), `layout.ts`(진입점). (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-범용-회로와-2차원-배치)
- **13.** `demo/gallery.html`은 종류별 회로를 빌드한 임베드 번들로 한 페이지에 그려 보는 정적 파일이다. (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-범용-회로와-2차원-배치)
- **14.** 논리 값 계산은 `src/web/lib/simulate.ts`의 `Simulator`가 하고, 누르기와 색 표시는 `src/web/schematic.ts`의 `createLogic`이 페이지와 임베드에 함께 제공한다. (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-입력을-눌러-동작-보기)
- **15.** 최신 주소의 캐시 비우기는 릴리스마다 한 번만 요청하고, 응답 본문의 `throttled`가 `true`이면 `throttlingReset`(초)이 지난 뒤 다시 요청한다. 연달아 릴리스할 때는 마지막 뒤에만 비운다. (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-최신-주소-갱신이-제한됨)
