# elecuit

LLM이 회로를 그릴 때 좌표를 직접 찍으면 선이 엉뚱한 곳에 닿아 회로가 틀어집니다. elecuit은 LLM이 좌표 대신 **netlist**(소자와 노드 이름)만 쓰게 하고, 회로도는 렌더러가 그립니다. 연결은 노드 이름이 같은지로만 정해지므로, 선언하지 않은 연결은 그려지지 않습니다.

## 쓰는 법

### 1. 주소 한 줄 (ChatGPT Canvas처럼 HTML 미리보기가 있는 채팅)

대화에 아래 한 줄을 넣습니다. 모델이 주소를 열 수 있어야 합니다(웹 검색 켜짐).

```text
https://cdn.jsdelivr.net/gh/Croksuter/elecuit@0.1.2/dist/prompt.md 이 문서의 지침대로 앞으로 회로도를 그려 줘.
```

그 뒤로 회로를 물으면 모델이 미리보기에 회로도를 띄웁니다. 새 대화에서는 한 줄을 다시 넣어야 합니다.

### 2. Custom GPT나 프로젝트 지침

[dist/prompt.md](dist/prompt.md)의 내용을 지침에 붙여 넣으면 매번 주소를 줄 필요가 없습니다.

### 3. 붙여 넣는 페이지

미리보기가 없는 모델은 netlist를 글로 답하게 하고, 그 답을 페이지에 붙여 넣어 봅니다. 저장소를 받아 `npm ci` 뒤 `npm run build`를 하면 `dist/index.html` 한 파일이 나옵니다. 이 페이지에서 netlist를 고치며 바로 볼 수 있고, SVG와 PNG로 저장할 수 있습니다.

## netlist

```text
# domino 게이트에 X precharge를 더한 회로
input  A B phi
output Z
label  phi $\phi$
pmos P1 g=phi d=Y  s=VDD
nmos N1 g=A   d=Y  s=X
nmos N2 g=B   d=X  s=n1
nmos N3 g=phi d=n1 s=GND
pmos P2 g=phi d=X  s=VDD
inv  I1 in=Y  out=Z
```

| 줄 | 형식 |
| --- | --- |
| `nmos`, `pmos` | `이름 g=게이트 d=드레인 s=소스` |
| `inv`, `buf` | `이름 in=입력 out=출력` |
| `nand`, `nor`, `and`, `or` | `이름 in=A,B[,C…] out=출력` |
| `cap` | `이름 a=노드 b=노드 [value=$C_L$]` |
| `input`, `output` | `A B …` 외부 단자 |
| `label` | `노드 $KaTeX$` 화면에 보일 이름 |

- `VDD`와 `GND`는 예약된 이름입니다.
- 노드와 소자 이름은 영문자·숫자·밑줄만 씁니다.
- 주석은 `#` 뒤에 씁니다.

## 직접 HTML에 넣기

```html
<script type="text/elecuit">
pmos P1 g=A d=Y s=VDD
nmos N1 g=A d=Y s=GND
</script>
<script src="https://cdn.jsdelivr.net/gh/Croksuter/elecuit@0.1.2/dist/elecuit.js"></script>
```

블록마다 회로도, 검사 결과(행 번호 포함), 노드에 연결된 단자 목록이 그려집니다. 수식은 KaTeX로 그립니다.

## 그리는 범위

- VDD와 GND 사이가 직렬·병렬로 분해되는 트랜지스터 회로는 스택으로 그립니다.
- 그렇지 않은 회로(브리지 등)는 소자별로 따로 그리고 노드 이름으로 연결을 표시합니다.

## 개발

```bash
npm ci
```

```bash
npm test
```

```bash
npm run build
```
