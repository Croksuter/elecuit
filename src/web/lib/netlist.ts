// role: parses elecuit netlist text into a circuit and reports syntax errors by line.

type TransistorKind = "nmos" | "pmos";
type GateKind = "inv" | "buf" | "nand" | "nor" | "and" | "or";

interface Transistor {
  kind: TransistorKind;
  name: string;
  line: number;
  g: string;
  d: string;
  s: string;
}

interface Gate {
  kind: GateKind;
  name: string;
  line: number;
  inputs: string[];
  output: string;
}

interface Capacitor {
  kind: "cap";
  name: string;
  line: number;
  a: string;
  b: string;
  value: string | null;
}

type Element = Transistor | Gate | Capacitor;

interface Circuit {
  elements: Element[];
  inputs: { net: string; line: number }[];
  outputs: { net: string; line: number }[];
  labels: Map<string, { tex: string; line: number }>;
}

interface Diagnostic {
  line: number;
  severity: "error" | "warning";
  message: string;
}

interface ParseResult {
  circuit: Circuit;
  diagnostics: Diagnostic[];
}

const RAILS = ["VDD", "GND"] as const;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TRANSISTOR_KINDS: TransistorKind[] = ["nmos", "pmos"];
const GATE_KINDS: GateKind[] = ["inv", "buf", "nand", "nor", "and", "or"];
const SINGLE_INPUT_GATES: GateKind[] = ["inv", "buf"];
const KEYWORDS = ["input", "output", "label", "cap", ...TRANSISTOR_KINDS, ...GATE_KINDS];

// TypeScript cannot narrow on a union-valued `kind` (nmos | pmos), so these guards do it once.
function isTransistor(element: Element): element is Transistor {
  return (TRANSISTOR_KINDS as string[]).includes(element.kind);
}

function isGate(element: Element): element is Gate {
  return (GATE_KINDS as string[]).includes(element.kind);
}

function isRail(net: string): boolean {
  return (RAILS as readonly string[]).includes(net);
}

// Splits a line on whitespace, keeping `$…$` spans (and `key=$…$`) as one token.
function tokenize(text: string): { tokens: string[]; isMathOpen: boolean } {
  const tokens: string[] = [];
  let current = "";
  let isMath = false;
  for (const character of text) {
    if (character === "$") isMath = !isMath;
    if (!isMath && /\s/.test(character)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current) tokens.push(current);
  return { tokens, isMathOpen: isMath };
}

function stripComment(text: string): string {
  let isMath = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "$") isMath = !isMath;
    if (!isMath && text[index] === "#") return text.slice(0, index);
  }
  return text;
}

// A pasted GPT answer may wrap the netlist in a code fence; only fenced lines are read then.
// The first ```elecuit block wins, otherwise the first fenced block.
function selectSourceLines(text: string): { text: string; line: number }[] {
  const lines = text.split(/\r?\n/).map((value, index) => ({ text: value, line: index + 1 }));
  const blocks: { language: string; lines: typeof lines }[] = [];
  let open: { language: string; lines: typeof lines } | null = null;
  for (const entry of lines) {
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(entry.text);
    if (fence) {
      if (open) {
        blocks.push(open);
        open = null;
      } else {
        open = { language: fence[1].toLowerCase(), lines: [] };
      }
      continue;
    }
    if (open) open.lines.push(entry);
  }
  if (open) blocks.push(open);
  if (blocks.length === 0) return lines;
  const chosen = blocks.find((block) => block.language === "elecuit") ?? blocks[0];
  return chosen.lines;
}

function parse(text: string): ParseResult {
  const circuit: Circuit = { elements: [], inputs: [], outputs: [], labels: new Map() };
  const diagnostics: Diagnostic[] = [];
  const names = new Map<string, number>();

  function error(line: number, message: string): void {
    diagnostics.push({ line, severity: "error", message });
  }

  // Returns null (after reporting) when the token is not a usable net name.
  function readNet(line: number, value: string, where: string): string | null {
    if (value.includes("$")) {
      error(line, `${where}: 노드 이름에는 $…$를 쓸 수 없습니다. label로 표시 이름을 정하세요.`);
      return null;
    }
    if (!NAME_PATTERN.test(value)) {
      error(line, `${where}: 노드 이름 "${value}"는 영문자·숫자·밑줄만 쓸 수 있습니다.`);
      return null;
    }
    return value;
  }

  // Reads `key=value` tokens; reports unknown, repeated and missing keys.
  function readFields(
    line: number,
    elementName: string,
    tokens: string[],
    required: string[],
    optional: string[],
  ): Map<string, string> | null {
    const fields = new Map<string, string>();
    let isValid = true;
    for (const token of tokens) {
      const separator = token.indexOf("=");
      if (separator <= 0) {
        error(line, `${elementName}: "${token}"는 단자=노드 형식이 아닙니다.`);
        isValid = false;
        continue;
      }
      const key = token.slice(0, separator);
      const value = token.slice(separator + 1);
      if (!required.includes(key) && !optional.includes(key)) {
        error(
          line,
          `${elementName}: 알 수 없는 단자 "${key}" (쓸 수 있는 단자: ${[...required, ...optional].join(", ")})`,
        );
        isValid = false;
      } else if (fields.has(key)) {
        error(line, `${elementName}: 단자 "${key}"가 두 번 나옵니다.`);
        isValid = false;
      } else if (value === "") {
        error(line, `${elementName}: 단자 "${key}"의 노드가 비어 있습니다.`);
        isValid = false;
      } else {
        fields.set(key, value);
      }
    }
    for (const key of required) {
      if (!fields.has(key) && isValid) {
        error(line, `${elementName}: 단자 ${key}가 없습니다.`);
        isValid = false;
      }
    }
    return isValid ? fields : null;
  }

  for (const source of selectSourceLines(text)) {
    const { line } = source;
    const { tokens, isMathOpen } = tokenize(stripComment(source.text));
    if (tokens.length === 0) continue;
    if (isMathOpen) {
      error(line, "$로 연 수식이 닫히지 않았습니다.");
      continue;
    }
    const [keyword, ...rest] = tokens;
    if (!KEYWORDS.includes(keyword)) {
      error(line, `알 수 없는 줄 "${keyword}" (쓸 수 있는 종류: ${KEYWORDS.join(", ")})`);
      continue;
    }

    if (keyword === "input" || keyword === "output") {
      if (rest.length === 0) error(line, `${keyword} 뒤에 노드 이름이 필요합니다.`);
      for (const value of rest) {
        const net = readNet(line, value, keyword);
        if (net === null) continue;
        if (isRail(net)) {
          error(line, `${keyword}: ${net}는 전원 레일이라 ${keyword}로 선언할 수 없습니다.`);
          continue;
        }
        (keyword === "input" ? circuit.inputs : circuit.outputs).push({ net, line });
      }
      continue;
    }

    if (keyword === "label") {
      if (rest.length !== 2) {
        error(line, "label은 `label 노드 $수식$` 형식입니다.");
        continue;
      }
      const net = readNet(line, rest[0], "label");
      const tex = rest[1];
      if (net === null) continue;
      if (!/^\$[^$]+\$$/.test(tex)) {
        error(line, "label: 표시 이름은 $…$로 감싼 KaTeX 수식이어야 합니다.");
        continue;
      }
      if (circuit.labels.has(net)) {
        error(
          line,
          `label: 노드 ${net}의 표시 이름이 이미 ${circuit.labels.get(net)!.line}행에 있습니다.`,
        );
        continue;
      }
      circuit.labels.set(net, { tex: tex.slice(1, -1), line });
      continue;
    }

    const [name, ...fieldTokens] = rest;
    if (name === undefined || name.includes("=")) {
      error(line, `${keyword}: 소자 이름이 필요합니다 (예: ${keyword} M1 …).`);
      continue;
    }
    if (!NAME_PATTERN.test(name)) {
      error(line, `소자 이름 "${name}"는 영문자·숫자·밑줄만 쓸 수 있습니다.`);
      continue;
    }
    if (names.has(name)) {
      error(line, `소자 이름 ${name}이 ${names.get(name)}행과 겹칩니다.`);
      continue;
    }
    names.set(name, line);

    if ((TRANSISTOR_KINDS as string[]).includes(keyword)) {
      const fields = readFields(line, name, fieldTokens, ["g", "d", "s"], []);
      if (fields === null) continue;
      const g = readNet(line, fields.get("g")!, `${name}.g`);
      const d = readNet(line, fields.get("d")!, `${name}.d`);
      const s = readNet(line, fields.get("s")!, `${name}.s`);
      if (g === null || d === null || s === null) continue;
      circuit.elements.push({ kind: keyword as TransistorKind, name, line, g, d, s });
      continue;
    }

    if ((GATE_KINDS as string[]).includes(keyword)) {
      const kind = keyword as GateKind;
      const fields = readFields(line, name, fieldTokens, ["in", "out"], []);
      if (fields === null) continue;
      const rawInputs = fields.get("in")!.split(",");
      const isSingle = SINGLE_INPUT_GATES.includes(kind);
      if (isSingle && rawInputs.length !== 1) {
        error(line, `${name}: ${kind}는 입력이 하나입니다.`);
        continue;
      }
      if (!isSingle && rawInputs.length < 2) {
        error(line, `${name}: ${kind}는 입력이 둘 이상입니다 (in=A,B).`);
        continue;
      }
      const inputs = rawInputs.map((value) => readNet(line, value, `${name}.in`));
      const output = readNet(line, fields.get("out")!, `${name}.out`);
      if (inputs.includes(null) || output === null) continue;
      if (isRail(output)) {
        error(line, `${name}: 출력을 ${output}에 연결할 수 없습니다.`);
        continue;
      }
      circuit.elements.push({ kind, name, line, inputs: inputs as string[], output });
      continue;
    }

    const fields = readFields(line, name, fieldTokens, ["a", "b"], ["value"]);
    if (fields === null) continue;
    const a = readNet(line, fields.get("a")!, `${name}.a`);
    const b = readNet(line, fields.get("b")!, `${name}.b`);
    if (a === null || b === null) continue;
    const rawValue = fields.get("value");
    if (rawValue !== undefined && !/^\$[^$]+\$$/.test(rawValue)) {
      error(line, `${name}: value는 $…$로 감싼 KaTeX 수식이어야 합니다.`);
      continue;
    }
    circuit.elements.push({
      kind: "cap",
      name,
      line,
      a,
      b,
      value: rawValue === undefined ? null : rawValue.slice(1, -1),
    });
  }

  return { circuit, diagnostics };
}

export type {
  Capacitor,
  Circuit,
  Diagnostic,
  Element,
  Gate,
  GateKind,
  ParseResult,
  Transistor,
  TransistorKind,
};
export { GATE_KINDS, isGate, isRail, isTransistor, parse, RAILS };
