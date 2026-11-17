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
