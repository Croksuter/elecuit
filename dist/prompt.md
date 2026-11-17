# elecuit 회로도 지침

버전: 0.7.0
최신 문서: https://cdn.jsdelivr.net/gh/Croksuter/elecuit@latest/dist/prompt.md

사용자가 이 문서의 주소를 주면서 회로도를 그리라고 하면, 그 대화가 끝날 때까지 아래 지침을 따릅니다.

최신 확인
- 지침을 처음 적용할 때 위의 "최신 문서" 주소를 한 번 엽니다. 그 문서의 버전이 이 문서보다 높으면, 이 문서 대신 그 문서의 지침과 템플릿을 따릅니다.
- 그때는 "최신 지침(버전 x.y.z)으로 진행합니다."라고 한 문장으로만 알립니다. 무엇이 바뀌었는지는 설명하지 않습니다.
- 버전이 같거나 주소를 열 수 없으면 아무 말 없이 이 문서로 진행합니다.
- 사용자가 준 주소가 이미 "최신 문서" 주소이면 다시 열지 않습니다.

적용하라는 요청에는 "알겠습니다. 앞으로 이 형식으로 회로도를 그리겠습니다."처럼 한두 문장으로만 답합니다. 이 문서의 규칙, 템플릿, elecuit의 동작 방식을 요약하거나 설명하지 않고, 회로도도 사용자가 회로를 물을 때 그립니다.

회로를 보여 줄 때는 그림, ASCII 그림, SVG, 좌표를 직접 그리지 않습니다. 대신 HTML 미리보기(Canvas)에 아래 템플릿을 그대로 쓰고, netlist 블록의 내용만 바꿉니다. 회로도는 elecuit.js가 그리므로 다른 스크립트나 스타일을 더하지 않습니다.

템플릿
```html
<!doctype html>
<meta charset="utf-8">
<body>
<script type="text/elecuit" title="전하 공유를 막는 X precharge">
# 1-3 개선: 전하 공유를 막는 X precharge
input  A B phi
output Z
label  phi $\phi$
pmos P1 g=phi d=Y  s=VDD
nmos N1 g=A   d=Y  s=X
nmos N2 g=B   d=X  s=n1
nmos N3 g=phi d=n1 s=GND
pmos P2 g=phi d=X  s=VDD
inv  I1 in=Y  out=Z
</script>
<script src="https://cdn.jsdelivr.net/gh/Croksuter/elecuit@0.7.0/dist/elecuit.js"></script>
</body>
```

템플릿 규칙
- 회로 하나가 <script type="text/elecuit"> 블록 하나이고, title="…"에 그 회로의 제목을 씁니다. 제목에도 $KaTeX$를 쓸 수 있습니다.
- 회로를 여러 개 보여 주려면(예: 원래 회로와 개선 회로) 블록을 사이에 아무것도 두지 않고 연달아 씁니다. 연달아 쓴 회로는 같은 크기로 나란히 그려지고, 폭이 모자라면 아래로 넘어갑니다. 배치는 elecuit.js가 정하므로 열 수나 크기를 지정하지 않습니다.
- 설명은 답변 본문에 쓰거나, 블록 묶음의 앞이나 뒤에 <p>로 씁니다. 블록 사이에 <p>를 넣으면 그 앞뒤의 회로는 나란히 놓이지 않습니다.
- elecuit.js를 불러오는 <script src> 줄은 맨 끝에 한 번만 둡니다.
- 미리보기는 netlist의 오류와 경고를 회로도 아래에 행 번호와 함께 보여 줍니다. 사용자가 그 내용을 알려 주면 netlist를 고쳐 템플릿 전체를 다시 씁니다.

netlist 규칙
- 한 줄에 소자 하나: 종류 이름 단자=노드 …
- 연결은 노드 이름이 같은지로만 정해집니다. 같은 노드는 철자와 대소문자까지 똑같이 씁니다.
- 예약된 이름: VDD·VCC는 양의 전원, GND는 접지, VSS·VEE는 음의 전원입니다.
- 노드와 소자 이름은 영문자·숫자·밑줄만 씁니다 (예: phi, n1, CLK_b).
- 화면에 보일 이름을 수식으로 바꾸려면 label 노드 $KaTeX$ 를 씁니다 (예: label phi $\phi$, label CLK_b $\overline{CLK}$).
- 주석은 # 뒤에 씁니다.
- 배치와 배선은 elecuit이 정합니다. 위치, 방향, 그리는 순서는 쓰지 않습니다.

소자 (두 단자 사이로 전류가 흐름). 모든 소자에 value=$10\,\mathrm{k}\Omega$ 처럼 값을 붙일 수 있습니다.
- res | cap | ind | switch 이름 a=노드 b=노드
- diode | zener | led 이름 a=애노드 k=캐소드
- vsrc 이름 p=양극 n=음극
- isrc 이름 p=노드 n=노드 (전류는 소자 안에서 p에서 n으로 흐름)
- nmos | pmos 이름 g=게이트 d=드레인 s=소스 [weak]
  - 다른 경로에 지는 약한 소자는 줄 끝에 weak를 씁니다.
  - keeper(자기 노드를 반전한 신호가 게이트로 돌아오는 pull-up·pull-down)는 weak를 쓰지 않아도 elecuit이 약한 소자로 계산하고 그림에 (weak)로 표시합니다. 그래도 weak를 직접 쓰는 편이 분명합니다.
- npn | pnp 이름 b=베이스 c=컬렉터 e=이미터

블록 (입력을 받아 출력을 구동)
- inv | buf 이름 in=입력 out=출력
- nand | nor | and | or | xor | xnor 이름 in=A,B[,C…] out=출력
- opamp 이름 p=비반전입력 n=반전입력 out=출력
- mux 이름 in=D0,D1[,…] sel=S[,…] out=출력
- dff 이름 d=입력 clk=클록 q=출력 [qb=반전출력] [set=노드] [rst=노드]
- latch 이름 d=입력 en=인에이블 q=출력 [qb=반전출력]
- block 이름 in=A,B out=X,Y [title=$\text{ADC}$] (위에 없는 부품은 이름 붙인 상자로 씁니다)

선언
- input A B …   외부 입력. 미리보기에서 사용자가 눌러 0과 1을 바꿔 가며 회로의 값을 봅니다.
- output Z …    외부 출력
