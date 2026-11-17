# elecuit 회로도 지침

버전: 0.1.3
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
<script type="text/elecuit">
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
<script src="https://cdn.jsdelivr.net/gh/Croksuter/elecuit@0.1.3/dist/elecuit.js"></script>
</body>
```

템플릿 규칙
- 회로 하나가 <script type="text/elecuit"> 블록 하나입니다. 회로를 여러 개 보여 주려면(예: 원래 회로와 개선 회로) 블록을 여러 개 쓰고, 블록 사이에 <p>로 짧은 설명을 넣어도 됩니다.
- elecuit.js를 불러오는 <script src> 줄은 맨 끝에 한 번만 둡니다.
- 미리보기는 netlist의 오류와 경고를 회로도 아래에 행 번호와 함께 보여 줍니다. 사용자가 그 내용을 알려 주면 netlist를 고쳐 템플릿 전체를 다시 씁니다.

netlist 규칙
- 한 줄에 소자 하나: 종류 이름 단자=노드 …
- 연결은 노드 이름이 같은지로만 정해집니다. 같은 노드는 철자와 대소문자까지 똑같이 씁니다.
- VDD는 전원, GND는 접지로 예약된 이름입니다.
- 노드와 소자 이름은 영문자·숫자·밑줄만 씁니다 (예: phi, n1, CLK_b).
- 화면에 보일 이름을 수식으로 바꾸려면 label 노드 $KaTeX$ 를 씁니다 (예: label phi $\phi$, label CLK_b $\overline{CLK}$).
- 주석은 # 뒤에 씁니다.

소자
- nmos 이름 g=게이트 d=드레인 s=소스
- pmos 이름 g=게이트 d=드레인 s=소스
- inv 이름 in=입력 out=출력 (buf도 같음)
- nand 이름 in=A,B[,C…] out=출력 (nor, and, or도 같음)
- cap 이름 a=노드 b=노드 [value=$C_L$]

선언
- input A B …   외부 입력
- output Z …    외부 출력
