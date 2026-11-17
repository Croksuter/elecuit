# elecuit

LLM이 회로를 그릴 때 좌표를 직접 찍으면 선이 엉뚱한 곳에 닿아 회로가 틀어집니다. elecuit은 LLM이 좌표 대신 **netlist**(소자와 노드 이름)만 쓰게 하고, 회로도는 렌더러가 그립니다. 연결은 노드 이름이 같은지로만 정해지므로, 선언하지 않은 연결은 그려지지 않습니다.

## 쓰는 법

### 1. 주소 한 줄 (ChatGPT Canvas처럼 HTML 미리보기가 있는 채팅)

대화에 아래 한 줄을 넣습니다. 모델이 주소를 열 수 있어야 합니다(웹 검색 켜짐).

```text
https://cdn.jsdelivr.net/gh/Croksuter/elecuit@latest/dist/prompt.md 이 문서의 지침대로 앞으로 회로도를 그려 줘.
```

그 뒤로 회로를 물으면 모델이 미리보기에 회로도를 띄웁니다. 새 대화에서는 한 줄을 다시 넣어야 합니다.

- 이 주소는 항상 가장 최근 릴리스의 지침을 내려 줍니다. 새 릴리스는 반나절에서 길게는 7일 안에 반영됩니다(jsDelivr 캐시).
- 버전이 적힌 예전 주소로 받은 지침도, 모델이 최신 문서를 한 번 확인해 더 높은 버전이 있으면 그쪽을 따릅니다.

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
| `res`, `cap`, `ind`, `switch` | `이름 a=노드 b=노드` |
| `diode`, `zener`, `led` | `이름 a=애노드 k=캐소드` |
| `vsrc` | `이름 p=양극 n=음극` |
| `isrc` | `이름 p=노드 n=노드` (전류는 소자 안에서 p에서 n으로) |
| `nmos`, `pmos` | `이름 g=게이트 d=드레인 s=소스` |
| `npn`, `pnp` | `이름 b=베이스 c=컬렉터 e=이미터` |
| `inv`, `buf` | `이름 in=입력 out=출력` |
| `nand`, `nor`, `and`, `or`, `xor`, `xnor` | `이름 in=A,B[,C…] out=출력` |
| `opamp` | `이름 p=비반전입력 n=반전입력 out=출력` |
| `mux` | `이름 in=D0,D1[,…] sel=S[,…] out=출력` |
| `dff` | `이름 d= clk= q= [qb=] [set=] [rst=]` |
| `latch` | `이름 d= en= q= [qb=]` |
| `block` | `이름 in=A,B out=X,Y [title=$\text{ADC}$]` 위에 없는 부품을 상자로 |
| `input`, `output` | `A B …` 외부 단자 |
| `label` | `노드 $KaTeX$` 화면에 보일 이름 |

- 소자에는 `value=$10\,\mathrm{k}\Omega$`처럼 값을 붙일 수 있습니다. `$…$` 없이 `value=330`처럼 쓰면 글자 그대로 보입니다.
- `VDD`·`VCC`(양의 전원), `GND`(접지), `VSS`·`VEE`(음의 전원)는 예약된 이름입니다.
- 노드와 소자 이름은 영문자·숫자·밑줄만 씁니다.
- 주석은 `#` 뒤에 씁니다.

## 직접 HTML에 넣기

```html
<script type="text/elecuit" title="인버터">
pmos P1 g=A d=Y s=VDD
nmos N1 g=A d=Y s=GND
</script>
<script src="https://cdn.jsdelivr.net/gh/Croksuter/elecuit@0.3.0/dist/elecuit.js"></script>
```

블록마다 회로도, 검사 결과(행 번호 포함), 노드에 연결된 단자 목록이 그려집니다. 수식은 KaTeX로 그립니다.

- `title`은 회로도 위에 제목으로 보이고, `$…$`로 감싼 부분은 수식으로 그립니다. 없어도 됩니다.
- 사이에 다른 요소 없이 연달아 쓴 블록은 한 묶음입니다. 한 묶음의 회로는 같은 배율로 나란히 놓이고, 폭이 모자라면 아래 줄로 넘어갑니다.
- 블록 사이에 `<p>` 같은 요소가 있으면 묶음이 나뉘어 따로 그려집니다.

## 그리는 방식

- 전류가 흐르는 소자들은 노드를 가로선으로, 소자를 그 사이의 세로 열로 놓습니다. 전원 쪽이 위, 접지 쪽이 아래입니다. 높이는 모든 소자를 같은 저항으로 보고 푼 노드 전위의 순서로 정하고, 전위가 같은 두 노드 사이의 소자는 눕혀 그립니다.
- 게이트·증폭기·플립플롭 같은 블록과 소자 묶음은 신호가 흐르는 순서대로 왼쪽에서 오른쪽 열에 놓고, 이웃한 열 사이는 선으로 잇습니다.
- 선은 다른 노드의 선과 닿지 않는다고 확인된 곳에만 긋습니다. 그 밖의 연결은 같은 노드 이름을 양쪽에 적어 나타냅니다. 이름이 같으면 같은 노드입니다.
- 연산 증폭기의 출력과 입력을 잇는 귀환 소자는 증폭기 위아래에 그립니다.
- 회로가 미리보기보다 넓으면 배율 0.6에서 멈추고 좌우로 스크롤합니다.
- [demo/gallery.html](demo/gallery.html)에 종류별 예가 있습니다 (`npm run build` 뒤 로컬 서버로 엽니다).

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
