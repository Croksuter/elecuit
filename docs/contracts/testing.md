# 테스트 값

## 명령

- **1.** 단위 테스트는 `npm test`(vitest, T1/unit)이고 `src/web/lib/__tests__/`에 둔다. (created by discussions/2026-11-17-elecuit-start.md#결정)
- **2.** 배치 테스트는 서로 다른 노드의 선이 닿지 않는지를 대표 회로마다 확인한다. (created by discussions/2026-11-17-elecuit-start.md#결정)
- ~~**3.** 비밀값 스캔 도구는 아직 정하지 않았다. 외부 서비스나 비밀값이 생기는 첫 보안 게이트에서 정한다.~~ (created by discussions/2026-11-17-elecuit-start.md#결정) (changed to #4)
- **4.** 비밀값 스캔은 커밋 전 `gitleaks git --staged --redact .`(T0)이고, 저장소 전체 이력은 `gitleaks git --redact .`로 본다. (created by discussions/2026-11-17-security.md#통제) (changed from #3)
- **5.** 의존성 취약점은 lockfile이 바뀔 때 `npm audit --omit=dev`(T0)로 확인한다. (created by discussions/2026-11-17-security.md#통제)
- **6.** netlist의 이름과 수식이 마크업이나 링크로 주입되지 않는지는 `src/web/lib/__tests__/render.test.ts`(T1/unit, `npm test`에 포함)가 확인한다. (created by discussions/2026-11-17-security.md#통제)
- **7.** 커밋한 `dist/elecuit.js`가 소스와 맞는지는 태그를 달기 전 `npm run build` 뒤 `git status --short dist`가 비어 있는지로 확인한다. (created by discussions/2026-11-17-security.md#통제)
- **8.** 템플릿의 번들 주소가 `package.json`의 version을 정확히 가리키는지는 `src/web/lib/__tests__/netlist.test.ts`(T1/unit)가 확인한다. (created by discussions/2026-11-17-security.md#2026-11-17-주소-고정)
- ~~**9.** `README.md`의 jsDelivr 주소가 모두 `package.json`의 version을 가리키는지는 `src/web/lib/__tests__/netlist.test.ts`(T1/unit)가 확인한다.~~ (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-지침-문서-배포) (changed to #10)
- **10.** `README.md`의 jsDelivr 주소가 최신 지침 주소와 현재 version의 번들 주소 둘뿐인지, 지침 문서가 자기 version과 최신 주소를 적는지는 `src/web/lib/__tests__/netlist.test.ts`(T1/unit)가 확인한다. (created by discussions/2026-11-17-security.md#2026-11-17-자동-최신화) (changed from #9)
- **11.** 한 묶음의 회로가 몇 열로 놓이고 어떤 배율을 함께 쓰는지는 `src/web/lib/__tests__/arrange.test.ts`(T1/unit, `npm test`에 포함)가 확인한다. (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-여러-회로-배치)
- **12.** 블록의 `title`이 마크업이나 링크로 주입되지 않는지는 `src/web/lib/__tests__/render.test.ts`(T1/unit, `npm test`에 포함)가 확인한다. (created by discussions/2026-11-17-security.md#2026-11-17-블록-제목)
- **13.** 배치의 올바름은 `src/web/lib/__tests__/layout.test.ts`(T1/unit)가 확인한다. 서로 다른 노드의 선이 닿지 않는지, 여러 조각으로 그려진 노드의 조각마다 그 이름이 있는지를 대표 회로와 무작위로 만든 회로 150개에서 본다. 사용자가 보고한 ALU는 `src/web/lib/__tests__/fixtures/alu.txt`에 둔다. (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-범용-회로와-2차원-배치)
- **14.** `$…$` 없이 쓴 `value`와 `title`이 마크업으로 주입되지 않는지는 `src/web/lib/__tests__/render.test.ts`(T1/unit)가 확인한다. (created by discussions/2026-11-17-security.md#2026-11-17-소자-값과-블록-제목)
- **15.** 논리 값 계산은 `src/web/lib/__tests__/simulate.test.ts`(T1/unit)가 확인한다. 게이트, CMOS NAND, domino의 precharge·evaluate·전하 공유, 약한 keeper, 저항 pull-up, 플립플롭과 MUX, NOR 래치, 정해지지 않는 고리, 아날로그 소자, ALU를 본다. (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-입력을-눌러-동작-보기)
- **16.** 사용자가 보낸 MUX형 ALU(`src/web/lib/__tests__/fixtures/alu-mux.txt`)는 64가지 입력 조합마다 F, Q, L, SUM, CO, EQ를 식의 값과 대조하고(`simulate.test.ts`), 배치 검사의 대표 회로에도 넣는다(`layout.test.ts`). (created by discussions/2026-11-17-elecuit-start.md#2026-11-17-keeper-판정-입력-해제-호버-강조)
