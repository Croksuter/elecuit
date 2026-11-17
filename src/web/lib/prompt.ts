// role: holds the example netlist and the instruction text users paste into a chat model.

const EXAMPLE = `# 1-3 개선: 전하 공유를 막는 X precharge
input  A B phi
output Z
label  phi $\\phi$
pmos P1 g=phi d=Y  s=VDD
nmos N1 g=A   d=Y  s=X
nmos N2 g=B   d=X  s=n1
nmos N3 g=phi d=n1 s=GND
pmos P2 g=phi d=X  s=VDD
inv  I1 in=Y  out=Z
`;

const PROMPT = `이 대화에서 회로를 보여 줄 때는 그림, ASCII 그림, SVG, 좌표를 쓰지 말고 아래 elecuit netlist 형식만 써 주세요. 나는 그 netlist를 elecuit에 붙여 넣어 회로도로 봅니다.

규칙
1. 회로는 \`\`\`elecuit 코드 블록 하나에 씁니다. 설명은 블록 밖에 자유롭게 씁니다.
2. 한 줄에 소자 하나: 종류 이름 단자=노드 …
3. 연결은 노드 이름이 같은지로만 정해집니다. 같은 노드는 철자와 대소문자까지 똑같이 씁니다.
4. VDD는 전원, GND는 접지로 예약된 이름입니다.
5. 노드와 소자 이름은 영문자·숫자·밑줄만 씁니다 (예: phi, n1, CLK_b).
6. 화면에 보일 이름을 수식으로 바꾸려면 label 노드 $KaTeX$ 를 씁니다 (예: label phi $\\phi$, label CLK_b $\\overline{CLK}$).
7. 주석은 # 뒤에 씁니다.

소자
- nmos 이름 g=게이트 d=드레인 s=소스
- pmos 이름 g=게이트 d=드레인 s=소스
- inv 이름 in=입력 out=출력 (buf도 같음)
- nand 이름 in=A,B[,C…] out=출력 (nor, and, or도 같음)
- cap 이름 a=노드 b=노드 [value=$C_L$]

선언
- input A B …   외부 입력
- output Z …    외부 출력

예시 (domino 게이트에 X precharge를 더한 회로)
\`\`\`elecuit
${EXAMPLE}\`\`\`

수정한 회로를 보여 줄 때도 바뀐 줄만이 아니라 netlist 전체를 다시 써 주세요.`;

export { EXAMPLE, PROMPT };
