// role: holds the example netlist and the instruction texts users give to a chat model.

import { version } from "../../../package.json";

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

// jsDelivr serves the tracked bundle from the GitHub repository. The address pins the exact tag,
// which is the package version, so a template keeps the bundle it was written for.
const EMBED_SCRIPT_URL = `https://cdn.jsdelivr.net/gh/Croksuter/elecuit@${version}/dist/elecuit.js`;

// Always the document of the highest release tag; jsDelivr refreshes this alias within 12 hours
// at its edge, and a client may keep its own copy for up to 7 days.
const LATEST_DOCUMENT_URL = "https://cdn.jsdelivr.net/gh/Croksuter/elecuit@latest/dist/prompt.md";

const GRAMMAR = `netlist 규칙
- 한 줄에 소자 하나: 종류 이름 단자=노드 …
- 연결은 노드 이름이 같은지로만 정해집니다. 같은 노드는 철자와 대소문자까지 똑같이 씁니다.
- VDD는 전원, GND는 접지로 예약된 이름입니다.
- 노드와 소자 이름은 영문자·숫자·밑줄만 씁니다 (예: phi, n1, CLK_b).
- 화면에 보일 이름을 수식으로 바꾸려면 label 노드 $KaTeX$ 를 씁니다 (예: label phi $\\phi$, label CLK_b $\\overline{CLK}$).
- 주석은 # 뒤에 씁니다.

소자
- nmos 이름 g=게이트 d=드레인 s=소스
- pmos 이름 g=게이트 d=드레인 s=소스
- inv 이름 in=입력 out=출력 (buf도 같음)
- nand 이름 in=A,B[,C…] out=출력 (nor, and, or도 같음)
- cap 이름 a=노드 b=노드 [value=$C_L$]

선언
- input A B …   외부 입력
- output Z …    외부 출력`;

const PROMPT = `이 대화에서 회로를 보여 줄 때는 그림, ASCII 그림, SVG, 좌표를 쓰지 말고 아래 elecuit netlist 형식만 써 주세요. 나는 그 netlist를 elecuit에 붙여 넣어 회로도로 봅니다.

회로는 \`\`\`elecuit 코드 블록 하나에 씁니다. 설명은 블록 밖에 자유롭게 씁니다.

${GRAMMAR}

예시 (domino 게이트에 X precharge를 더한 회로)
\`\`\`elecuit
${EXAMPLE}\`\`\`

수정한 회로를 보여 줄 때도 바뀐 줄만이 아니라 netlist 전체를 다시 써 주세요.`;

// Instructions for a model that can preview HTML (ChatGPT Canvas, Claude artifacts): it writes a
// short page that loads the embed bundle from `scriptUrl` and fills in netlist blocks only.
function canvasPrompt(scriptUrl: string): string {
  return `회로를 보여 줄 때는 그림, ASCII 그림, SVG, 좌표를 직접 그리지 않습니다. 대신 HTML 미리보기(Canvas)에 아래 템플릿을 그대로 쓰고, netlist 블록의 내용만 바꿉니다. 회로도는 elecuit.js가 그리므로 다른 스크립트나 스타일을 더하지 않습니다.

템플릿
\`\`\`html
<!doctype html>
<meta charset="utf-8">
<body>
<script type="text/elecuit">
${EXAMPLE}</script>
<script src="${scriptUrl}"></script>
</body>
\`\`\`

템플릿 규칙
- 회로 하나가 <script type="text/elecuit"> 블록 하나입니다. 회로를 여러 개 보여 주려면(예: 원래 회로와 개선 회로) 블록을 여러 개 쓰고, 블록 사이에 <p>로 짧은 설명을 넣어도 됩니다.
- elecuit.js를 불러오는 <script src> 줄은 맨 끝에 한 번만 둡니다.
- 미리보기는 netlist의 오류와 경고를 회로도 아래에 행 번호와 함께 보여 줍니다. 사용자가 그 내용을 알려 주면 netlist를 고쳐 템플릿 전체를 다시 씁니다.

${GRAMMAR}`;
}

// The document a model reads by address: how to apply the instructions, how to move to a newer
// release of this document, then the Canvas instructions themselves.
function promptDocument(): string {
  return `# elecuit 회로도 지침

버전: ${version}
최신 문서: ${LATEST_DOCUMENT_URL}

사용자가 이 문서의 주소를 주면서 회로도를 그리라고 하면, 그 대화가 끝날 때까지 아래 지침을 따릅니다.

최신 확인
- 지침을 처음 적용할 때 위의 "최신 문서" 주소를 한 번 엽니다. 그 문서의 버전이 이 문서보다 높으면, 이 문서 대신 그 문서의 지침과 템플릿을 따릅니다.
- 그때는 "최신 지침(버전 x.y.z)으로 진행합니다."라고 한 문장으로만 알립니다. 무엇이 바뀌었는지는 설명하지 않습니다.
- 버전이 같거나 주소를 열 수 없으면 아무 말 없이 이 문서로 진행합니다.
- 사용자가 준 주소가 이미 "최신 문서" 주소이면 다시 열지 않습니다.

적용하라는 요청에는 "알겠습니다. 앞으로 이 형식으로 회로도를 그리겠습니다."처럼 한두 문장으로만 답합니다. 이 문서의 규칙, 템플릿, elecuit의 동작 방식을 요약하거나 설명하지 않고, 회로도도 사용자가 회로를 물을 때 그립니다.

${canvasPrompt(EMBED_SCRIPT_URL)}
`;
}

export { canvasPrompt, EMBED_SCRIPT_URL, EXAMPLE, LATEST_DOCUMENT_URL, PROMPT, promptDocument };
