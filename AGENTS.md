# elecuit

- **무엇.** LLM이 좌표 대신 netlist로 회로를 쓰게 하고, 그 netlist를 겹침 없는 회로도로 그리는 단일 웹 페이지.
- **명령.** `npm run dev`, `npm test`, `npm run check`, `npm run build`(결과: `dist/index.html`).

## 디자인

- **규칙.** 사용자 요청으로 하우스 스타일과 `hy-ui-design` 시안 절차를 쓰지 않는다 (`docs/discussions/2026-11-17-elecuit-start.md`).

## 코드

- **규칙.** `CODE`와 `hy-code-style`을 따른다.
- **값.** `docs/contracts/code.md`.
- **갱신.** 도구나 구조를 바꾸면 같은 변경에서 이 문서를 고친다.

## 테스트

- **규칙.** `TEST`와 `hy-test-ladder`를 따른다.
- **값.** `docs/contracts/testing.md`.
- **갱신.** 테스트 명령이나 배치를 바꾸면 같은 변경에서 이 문서를 고친다.

## 문서

- **값.** `docs/contracts/code.md`, `docs/contracts/testing.md`: 코드나 테스트를 바꿀 때 읽는다.
- **논의.** `docs/discussions/`: 결정의 이유를 찾을 때 읽는다.
