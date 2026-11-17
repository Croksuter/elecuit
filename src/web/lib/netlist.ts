// role: parses elecuit netlist text into a circuit and reports syntax errors by line.

type DeviceKind =
  | "nmos"
  | "pmos"
  | "npn"
  | "pnp"
  | "res"
  | "cap"
  | "ind"
  | "switch"
  | "diode"
  | "zener"
  | "led"
  | "vsrc"
  | "isrc";
type BlockKind =
  | "inv"
  | "buf"
  | "nand"
  | "nor"
  | "and"
  | "or"
  | "xor"
  | "xnor"
  | "opamp"
  | "mux"
  | "dff"
  | "latch"
  | "block";

// One connection of an element: `key` is the terminal as the netlist names it (g, a, in, …).
interface Terminal {
  key: string;
  net: string;
}

// A value or title shown next to an element: KaTeX when written as $…$, plain text otherwise.
interface Caption {
  text: string;
  isTex: boolean;
}

// Conducts between its two pins; a transistor's third terminal controls it without conducting.
interface Device {
  type: "device";
  kind: DeviceKind;
  name: string;
  line: number;
  pins: [Terminal, Terminal];
  control: Terminal | null;
  value: Caption | null;
  // A weak device loses to any other path that drives the same node (a keeper, a bleeder).
  isWeak: boolean;
  // True when the netlist did not say `weak` and the device was found to be a keeper.
  isAssumedWeak: boolean;
}

// Reads its inputs and drives its outputs: a logic gate, an op-amp, a flip-flop or a plain box.
interface Block {
  type: "block";
  kind: BlockKind;
  name: string;
  line: number;
  inputs: Terminal[];
  outputs: Terminal[];
  title: Caption | null;
}

type Element = Device | Block;

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

interface BlockField {
  key: string;
  isList: boolean;
  isRequired: boolean;
}

const TOP_RAILS = ["VDD", "VCC"];
const BOTTOM_RAILS = ["GND", "VSS", "VEE"];
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DEVICE_TERMINALS: Record<DeviceKind, { pins: [string, string]; control: string | null }> = {
  nmos: { pins: ["d", "s"], control: "g" },
  pmos: { pins: ["d", "s"], control: "g" },
  npn: { pins: ["c", "e"], control: "b" },
  pnp: { pins: ["c", "e"], control: "b" },
  res: { pins: ["a", "b"], control: null },
  cap: { pins: ["a", "b"], control: null },
  ind: { pins: ["a", "b"], control: null },
  switch: { pins: ["a", "b"], control: null },
  diode: { pins: ["a", "k"], control: null },
  zener: { pins: ["a", "k"], control: null },
  led: { pins: ["a", "k"], control: null },
  vsrc: { pins: ["p", "n"], control: null },
  isrc: { pins: ["p", "n"], control: null },
};

const ONE = { isList: false, isRequired: true };
const MANY = { isList: true, isRequired: true };
const MAYBE = { isList: false, isRequired: false };
const GATE_FIELDS = { inputs: [{ key: "in", ...MANY }], outputs: [{ key: "out", ...ONE }] };
const BLOCK_FIELDS: Record<BlockKind, { inputs: BlockField[]; outputs: BlockField[] }> = {
  inv: GATE_FIELDS,
  buf: GATE_FIELDS,
  nand: GATE_FIELDS,
  nor: GATE_FIELDS,
  and: GATE_FIELDS,
  or: GATE_FIELDS,
  xor: GATE_FIELDS,
  xnor: GATE_FIELDS,
  opamp: {
    inputs: [
      { key: "n", ...ONE },
      { key: "p", ...ONE },
    ],
    outputs: [{ key: "out", ...ONE }],
  },
  mux: {
    inputs: [
      { key: "in", ...MANY },
      { key: "sel", ...MANY },
    ],
    outputs: [{ key: "out", ...ONE }],
  },
  dff: {
    inputs: [
      { key: "d", ...ONE },
      { key: "clk", ...ONE },
      { key: "set", ...MAYBE },
      { key: "rst", ...MAYBE },
    ],
    outputs: [
      { key: "q", ...ONE },
      { key: "qb", ...MAYBE },
    ],
  },
  latch: {
    inputs: [
      { key: "d", ...ONE },
      { key: "en", ...ONE },
    ],
    outputs: [
      { key: "q", ...ONE },
      { key: "qb", ...MAYBE },
    ],
  },
  block: {
    inputs: [{ key: "in", isList: true, isRequired: false }],
    outputs: [{ key: "out", isList: true, isRequired: false }],
  },
};
const SINGLE_INPUT_GATES: BlockKind[] = ["inv", "buf"];
const MULTI_INPUT_GATES: BlockKind[] = ["nand", "nor", "and", "or", "xor", "xnor", "mux"];
const KEYWORDS = [
  "input",
  "output",
  "label",
  ...Object.keys(DEVICE_TERMINALS),
  ...Object.keys(BLOCK_FIELDS),
];

function isTopRail(net: string): boolean {
  return TOP_RAILS.includes(net);
}

function isBottomRail(net: string): boolean {
  return BOTTOM_RAILS.includes(net);
}

function isRail(net: string): boolean {
  return isTopRail(net) || isBottomRail(net);
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

// A keeper holds a node at the rail it already sits at: a pull-up or pull-down whose gate is that
// node inverted. It can only work if it is weaker than whatever else drives the node, so it is
// taken as weak even when the netlist does not say so.
function markKeepers(elements: Element[]): void {
  const mos = elements.filter(
    (element): element is Device =>
      element.type === "device" && (element.kind === "nmos" || element.kind === "pmos"),
  );
  // Whether `output` is `input` inverted, by an inverter block or a pair of transistors.
  function isInverted(input: string, output: string): boolean {
    const hasBlock = elements.some(
      (element) =>
        element.type === "block" &&
        element.kind === "inv" &&
        element.inputs[0].net === input &&
        element.outputs[0].net === output,
    );
    const pulls = (kind: "nmos" | "pmos", isRailSide: (net: string) => boolean): boolean =>
      mos.some(
        (device) =>
          device.kind === kind &&
          device.control!.net === input &&
          device.pins.some((pin) => pin.net === output) &&
          device.pins.some((pin) => isRailSide(pin.net)),
      );
    return hasBlock || (pulls("pmos", isTopRail) && pulls("nmos", isBottomRail));
  }
  for (const device of mos) {
    if (device.isWeak) continue;
    const node = device.pins.find((pin) => !isRail(pin.net));
    const rail = device.pins.find((pin) => isRail(pin.net));
    if (!node || !rail || node.net === device.control!.net) continue;
    const isHolding = (device.kind === "pmos") === isTopRail(rail.net);
    if (isHolding && isInverted(node.net, device.control!.net)) {
      device.isWeak = true;
      device.isAssumedWeak = true;
    }
  }
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

  // Reads an optional `value=`/`title=` field. Returns undefined (after reporting) when malformed.
  function readCaption(
    line: number,
    elementName: string,
    key: string,
    raw: string | undefined,
  ): Caption | null | undefined {
    if (raw === undefined) return null;
    if (/^\$[^$]+\$$/.test(raw)) return { text: raw.slice(1, -1), isTex: true };
    if (raw.includes("$")) {
      error(line, `${elementName}: ${key}의 수식은 $…$로 감싸야 합니다.`);
      return undefined;
    }
    return { text: raw, isTex: false };
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

    if (keyword in DEVICE_TERMINALS) {
      const kind = keyword as DeviceKind;
      const spec = DEVICE_TERMINALS[kind];
      const required = spec.control === null ? spec.pins : [spec.control, ...spec.pins];
      // `weak` stands alone on a MOS line; every other token is `key=value`.
      const isMos = kind === "nmos" || kind === "pmos";
      const isWeak = isMos && fieldTokens.includes("weak");
      const fields = readFields(
        line,
        name,
        isWeak ? fieldTokens.filter((token) => token !== "weak") : fieldTokens,
        required,
        ["value"],
      );
      if (fields === null) continue;
      const nets = required.map((key) => readNet(line, fields.get(key)!, `${name}.${key}`));
      const value = readCaption(line, name, "value", fields.get("value"));
      if (nets.includes(null) || value === undefined) continue;
      const terminals = required.map((key, index) => ({ key, net: nets[index]! }));
      circuit.elements.push({
        type: "device",
        kind,
        name,
        line,
        pins: terminals.slice(-2) as [Terminal, Terminal],
        control: spec.control === null ? null : terminals[0],
        value,
        isWeak,
        isAssumedWeak: false,
      });
      continue;
    }

    const kind = keyword as BlockKind;
    const spec = BLOCK_FIELDS[kind];
    const all = [...spec.inputs, ...spec.outputs];
    const fields = readFields(
      line,
      name,
      fieldTokens,
      all.filter((field) => field.isRequired).map((field) => field.key),
      [...all.filter((field) => !field.isRequired).map((field) => field.key), "title"],
    );
    if (fields === null) continue;
    let isValid = true;
    function readTerminals(group: BlockField[]): Terminal[] {
      return group.flatMap((field) => {
        const raw = fields!.get(field.key);
        if (raw === undefined) return [];
        const values = raw.split(",");
        if (!field.isList && values.length !== 1) {
          error(line, `${name}: 단자 ${field.key}에는 노드 하나만 씁니다.`);
          isValid = false;
          return [];
        }
        return values.flatMap((value) => {
          const net = readNet(line, value, `${name}.${field.key}`);
          if (net === null) isValid = false;
          return net === null ? [] : [{ key: field.key, net }];
        });
      });
    }
    const inputs = readTerminals(spec.inputs);
    const outputs = readTerminals(spec.outputs);
    const title = readCaption(line, name, "title", fields.get("title"));
    if (!isValid || title === undefined) continue;
    const gateInputs = inputs.filter((terminal) => terminal.key === "in").length;
    if (SINGLE_INPUT_GATES.includes(kind) && gateInputs !== 1) {
      error(line, `${name}: ${kind}는 입력이 하나입니다.`);
      continue;
    }
    if (MULTI_INPUT_GATES.includes(kind) && gateInputs < 2) {
      error(line, `${name}: ${kind}는 입력이 둘 이상입니다 (in=A,B).`);
      continue;
    }
    if (inputs.length + outputs.length === 0) {
      error(line, `${name}: in이나 out에 노드가 하나는 있어야 합니다.`);
      continue;
    }
    const railOutput = outputs.find((terminal) => isRail(terminal.net));
    if (railOutput) {
      error(line, `${name}: 출력을 ${railOutput.net}에 연결할 수 없습니다.`);
      continue;
    }
    circuit.elements.push({ type: "block", kind, name, line, inputs, outputs, title });
  }

  markKeepers(circuit.elements);
  return { circuit, diagnostics };
}

export type { Block, Caption, Circuit, Device, DeviceKind, Diagnostic, Element, Terminal };
export { isBottomRail, isRail, isTopRail, parse };
