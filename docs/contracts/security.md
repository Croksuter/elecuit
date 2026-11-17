# Security

## 등급

- ~~**1.** S1 — 노출 타인에게 배포하는 스크립트(GitHub 공개 저장소, jsDelivr), 데이터 없음, 권한 없음, AI 없음; 승인 discussions/2026-11-17-security.md#보류~~ (created by discussions/2026-11-17-security.md) (changed to #9)
- **9.** S1 — 노출 타인에게 배포하는 스크립트(GitHub 공개 저장소, jsDelivr), 데이터 없음, 권한 없음, AI 없음; 승인 discussions/2026-11-17-security.md#2026-11-17-주소-고정 (created by discussions/2026-11-17-security.md#2026-11-17-주소-고정) (changed from #1)

## 경계

- **2.** 브라우저 안에서만 netlist를 처리하고, 밖으로는 jsDelivr의 KaTeX 스타일·글꼴만 요청한다: discussions/2026-11-17-security.md#확인한-사실 (created by discussions/2026-11-17-security.md)

## 통제

- **3.** netlist의 이름은 영문자·숫자·밑줄만 받고, 진단은 `textContent`로, 수식은 KaTeX 기본 설정으로 그린다 — 구현 `src/web/lib/netlist.ts`, `src/web/lib/render.ts`, `src/web/embed.ts`, 검사 `testing.md#6` (created by discussions/2026-11-17-security.md)
- **4.** 커밋 전 비밀값 스캔 — 검사 `testing.md#4` (created by discussions/2026-11-17-security.md)
- **5.** lockfile 변경 시 의존성 취약점 확인 — 검사 `testing.md#5` (created by discussions/2026-11-17-security.md)
- **6.** 태그 전 번들과 소스의 일치 확인 — 검사 `testing.md#7` (created by discussions/2026-11-17-security.md)
- **7.** 배포 권한은 GitHub 저장소 쓰기 권한이므로 그 계정에 2단계 인증을 둔다 — 구현 GitHub 계정 설정(사용자) (created by discussions/2026-11-17-security.md)
- ~~**10.** 템플릿의 번들 주소는 범위가 아니라 정확한 태그(`package.json`의 `version`)를 가리킨다. 새 태그는 이미 배포된 템플릿에 반영되지 않는다 — 구현 `src/web/lib/prompt.ts`, 검사 `testing.md#8`~~ (created by discussions/2026-11-17-security.md#2026-11-17-주소-고정) (changed to #12)
- **12.** 지침 문서마다 그 안의 번들 주소는 같은 version의 정확한 태그를 가리켜, 지침과 번들이 항상 짝이 맞는다. 지침 문서 자체는 최신 주소로 자동 갱신되므로(#13), 이 고정은 새 릴리스가 퍼지는 것을 막는 통제가 아니다 — 구현 `src/web/lib/prompt.ts`, 검사 `testing.md#8` (created by discussions/2026-11-17-security.md#2026-11-17-자동-최신화) (changed from #10)
- **14.** 블록의 `title`은 글자를 이스케이프하고 `$…$`로 감싼 부분만 KaTeX 기본 설정으로 그린다 — 구현 `src/web/lib/render.ts`, 검사 `testing.md#12` (created by discussions/2026-11-17-security.md#2026-11-17-블록-제목)

## 수용한 위험

- **11.** 임베드 번들이 jsDelivr의 KaTeX 스타일을 무결성 해시(SRI) 없이 불러온다. jsDelivr나 그 경로가 변조되면 미리보기의 스타일이 바뀔 수 있다; 재검토 번들이 netlist 밖의 데이터를 다루게 되거나 KaTeX를 불러오는 방식을 바꿀 때; 승인 discussions/2026-11-17-security.md#2026-11-17-스타일-해시 (created by discussions/2026-11-17-security.md#2026-11-17-스타일-해시)
- **13.** 지침 문서는 최신 주소(`@latest`)로 나눠 주고, 버전이 적힌 문서도 모델에게 최신 문서를 확인해 따르게 한다. 새 태그가 올라가면 모든 사용자의 대화에 자동으로 적용되므로, 저장소 쓰기 권한이 탈취되면 바뀐 지침과 번들이 같은 경로로 퍼진다. 통제는 #7(2단계 인증)뿐이다; 재검토 저장소에 쓰기 권한자가 늘거나, 번들이나 지침이 netlist 밖의 데이터나 동작을 다루게 될 때; 승인 discussions/2026-11-17-security.md#2026-11-17-자동-최신화 (created by discussions/2026-11-17-security.md#2026-11-17-자동-최신화)

## 재점검

- **8.** 서버·계정·모델 호출이 생기거나, 번들이 jsDelivr 밖의 주소를 새로 요청하게 되면 게이트를 다시 연다. (created by discussions/2026-11-17-security.md)
