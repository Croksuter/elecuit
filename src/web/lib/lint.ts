// role: finds connection mistakes in a parsed circuit (typo nodes, shorts, conflicting outputs).

import katex from "katex";

import { isGate, isRail, isTransistor } from "./netlist";
import type { Circuit, Diagnostic } from "./netlist";

interface NetUse {
  line: number;
  where: string;
}

function collectNetUses(circuit: Circuit): Map<string, NetUse[]> {
  const uses = new Map<string, NetUse[]>();
  function add(net: string, line: number, where: string): void {
    const list = uses.get(net) ?? [];
    list.push({ line, where });
    uses.set(net, list);
  }
  for (const element of circuit.elements) {
    if (isTransistor(element)) {
      add(element.g, element.line, `${element.name}.g`);
      add(element.d, element.line, `${element.name}.d`);
      add(element.s, element.line, `${element.name}.s`);
    } else if (element.kind === "cap") {
      add(element.a, element.line, `${element.name}.a`);
      add(element.b, element.line, `${element.name}.b`);
    } else {
      for (const input of element.inputs) add(input, element.line, `${element.name}.in`);
      add(element.output, element.line, `${element.name}.out`);
    }
  }
  return uses;
}

function lint(circuit: Circuit): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const uses = collectNetUses(circuit);
  const declared = new Set([...circuit.inputs, ...circuit.outputs].map((entry) => entry.net));
  const known = new Set([...uses.keys(), ...declared]);

  function warn(line: number, message: string): void {
    diagnostics.push({ line, severity: "warning", message });
  }

  for (const [net, list] of uses) {
    if (isRail(net) || declared.has(net) || list.length > 1) continue;
    const similar = [...known].find(
      (other) => other !== net && other.toLowerCase() === net.toLowerCase(),
    );
    const hint = similar ? ` ${similar}의 오타인가요?` : " 다른 곳과 연결되지 않습니다.";
    warn(list[0].line, `${list[0].where}: 노드 ${net}는 한 곳에서만 쓰입니다.${hint}`);
  }

  for (const element of circuit.elements) {
    if (isTransistor(element) && element.d === element.s) {
      warn(
        element.line,
        `${element.name}: 드레인과 소스가 같은 노드 ${element.d}에 묶여 있습니다.`,
      );
    }
    if (
      isTransistor(element) &&
      isRail(element.d) &&
      isRail(element.s) &&
      element.d !== element.s
    ) {
      warn(element.line, `${element.name}: 켜지면 VDD와 GND가 바로 이어집니다.`);
    }
    if (element.kind === "cap" && element.a === element.b) {
      warn(element.line, `${element.name}: 두 단자가 같은 노드 ${element.a}에 묶여 있습니다.`);
    }
  }

  const drivers = new Map<string, string>();
  for (const element of circuit.elements) {
    if (!isGate(element)) continue;
    const previous = drivers.get(element.output);
    if (previous) {
      diagnostics.push({
        line: element.line,
        severity: "error",
        message: `${element.name}: 출력 ${element.output}를 ${previous}도 구동합니다.`,
      });
    } else {
      drivers.set(element.output, element.name);
    }
  }

  for (const entry of [...circuit.inputs, ...circuit.outputs]) {
    if (!uses.has(entry.net)) warn(entry.line, `선언한 노드 ${entry.net}를 쓰는 소자가 없습니다.`);
  }
  for (const entry of circuit.inputs) {
    const driver = drivers.get(entry.net);
    if (driver) warn(entry.line, `input ${entry.net}를 ${driver}가 구동합니다.`);
  }
  for (const [net, label] of circuit.labels) {
    if (!known.has(net)) warn(label.line, `label: 노드 ${net}가 회로에 없습니다.`);
  }

  const formulas = [
    ...[...circuit.labels.values()].map((label) => ({ tex: label.tex, line: label.line })),
    ...circuit.elements.flatMap((element) =>
      element.kind === "cap" && element.value !== null
        ? [{ tex: element.value, line: element.line }]
        : [],
    ),
  ];
  for (const formula of formulas) {
    try {
      katex.renderToString(formula.tex, { throwOnError: true });
    } catch (caught) {
      const reason = caught instanceof katex.ParseError ? caught.rawMessage : String(caught);
      diagnostics.push({
        line: formula.line,
        severity: "error",
        message: `KaTeX 수식 $${formula.tex}$를 읽을 수 없습니다: ${reason}`,
      });
    }
  }

  return diagnostics.sort((left, right) => left.line - right.line);
}

export type { NetUse };
export { collectNetUses, lint };
