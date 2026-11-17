# Security

## 등급

- **1.** S1 — 노출 타인에게 배포하는 스크립트(GitHub 공개 저장소, jsDelivr), 데이터 없음, 권한 없음, AI 없음; 승인 discussions/2026-11-17-security.md#보류 (created by discussions/2026-11-17-security.md)

## 경계

- **2.** 브라우저 안에서만 netlist를 처리하고, 밖으로는 jsDelivr의 KaTeX 스타일·글꼴만 요청한다: discussions/2026-11-17-security.md#확인한-사실 (created by discussions/2026-11-17-security.md)

## 통제

- **3.** netlist의 이름은 영문자·숫자·밑줄만 받고, 진단은 `textContent`로, 수식은 KaTeX 기본 설정으로 그린다 — 구현 `src/web/lib/netlist.ts`, `src/web/lib/render.ts`, `src/web/embed.ts`, 검사 `testing.md#6` (created by discussions/2026-11-17-security.md)
- **4.** 커밋 전 비밀값 스캔 — 검사 `testing.md#4` (created by discussions/2026-11-17-security.md)
- **5.** lockfile 변경 시 의존성 취약점 확인 — 검사 `testing.md#5` (created by discussions/2026-11-17-security.md)
- **6.** 태그 전 번들과 소스의 일치 확인 — 검사 `testing.md#7` (created by discussions/2026-11-17-security.md)
- **7.** 배포 권한은 GitHub 저장소 쓰기 권한이므로 그 계정에 2단계 인증을 둔다 — 구현 GitHub 계정 설정(사용자) (created by discussions/2026-11-17-security.md)

## 재점검

- **8.** 서버·계정·모델 호출이 생기거나, 번들이 jsDelivr 밖의 주소를 새로 요청하게 되면 게이트를 다시 연다. (created by discussions/2026-11-17-security.md)
