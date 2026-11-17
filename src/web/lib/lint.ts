// role: finds connection mistakes in a parsed circuit (typo nodes, shorts, conflicting outputs).

import katex from "katex";

import type { Circuit, Diagnostic, Element, Terminal } from "./netlist";

interface NetUse {
  line: number;
  where: string;
}

function terminalsOf(element: Element): Terminal[] {
  if (element.type === "block") return [...element.inputs, ...element.outputs];
  return element.control === null ? element.pins : [element.control, ...element.pins];
}

function collectNetUses(circuit: Circuit): Map<string, NetUse[]> {
  const uses = new Map<string, NetUse[]>();
  for (const element of circuit.elements) {
    for (const terminal of terminalsOf(element)) {
      const list = uses.get(terminal.net) ?? [];
      list.push({ line: element.line, where: `${element.name}.${terminal.key}` });
      uses.set(terminal.net, list);
    }
  }
  return uses;
}

function lint(circuit: Circuit): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const uses = collectNetUses(circuit);
  const { rails } = circuit;
  const declared = new Set([...circuit.inputs, ...circuit.outputs].map((entry) => entry.net));
  const known = new Set([...uses.keys(), ...declared]);

  function warn(line: number, message: string): void {
    diagnostics.push({ line, severity: "warning", message });
  }

  for (const [net, list] of uses) {
    if (rails.has(net) || declared.has(net) || list.length > 1) continue;
    const similar = [...known].find(
      (other) => other !== net && other.toLowerCase() === net.toLowerCase(),
    );
    const hint = similar ? ` ${similar}의 오타인가요?` : " 다른 곳과 연결되지 않습니다.";
    warn(list[0].line, `${list[0].where}: 노드 ${net}는 한 곳에서만 쓰입니다.${hint}`);
  }

  for (const element of circuit.elements) {
    if (element.type !== "device") continue;
    const [first, second] = element.pins;
    if (first.net === second.net) {
      warn(element.line, `${element.name}: 두 단자가 같은 노드 ${first.net}에 묶여 있습니다.`);
    }
    const isAcrossSupply =
      (rails.isPower(first.net) && rails.isGround(second.net)) ||
      (rails.isGround(first.net) && rails.isPower(second.net));
    if (element.control !== null && isAcrossSupply) {
      warn(element.line, `${element.name}: 켜지면 ${first.net}와 ${second.net}가 바로 이어집니다.`);
    }
  }

  for (const element of circuit.elements) {
    if (element.type !== "device" || !element.isAssumedWeak) continue;
    const node = element.pins.find((pin) => !rails.has(pin.net))!;
    warn(
      element.line,
      `${element.name}: ${node.net}를 반전한 ${element.control!.net}가 게이트로 돌아오는 keeper로 보고 약한 소자로 계산합니다. 줄 끝에 weak를 쓰면 이 안내가 사라집니다.`,
    );
  }

  const drivers = new Map<string, string>();
  for (const element of circuit.elements) {
    if (element.type !== "block") continue;
    for (const output of element.outputs) {
      const previous = drivers.get(output.net);
      if (previous) {
        diagnostics.push({
          line: element.line,
          severity: "error",
          message: `${element.name}: 출력 ${output.net}를 ${previous}도 구동합니다.`,
        });
      } else {
        drivers.set(output.net, element.name);
      }
    }
  }

  for (const entry of [
    ...circuit.inputs,
    ...circuit.outputs,
    ...circuit.power,
    ...circuit.ground,
  ]) {
    if (!uses.has(entry.net)) warn(entry.line, `선언한 노드 ${entry.net}를 쓰는 소자가 없습니다.`);
  }
  // A supply is one only when declared. These names are almost always meant as supplies, so
  // leaving the declaration out is worth pointing at; it does not make them supplies.
  for (const [net, list] of uses) {
    if (rails.has(net)) continue;
    const keyword = /^(vdd|vcc)$/i.test(net)
      ? "power"
      : /^(gnd|vss|vee)$/i.test(net)
        ? "ground"
        : null;
    if (keyword === null) continue;
    warn(
      list[0].line,
      `${net}: ${keyword}로 선언하지 않아 보통 노드로 다룹니다. ${keyword === "power" ? "전원" : "접지"}이면 "${keyword} ${net}" 줄을 넣으세요.`,
    );
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
    ...circuit.elements.flatMap((element) => {
      const caption = element.type === "device" ? element.value : element.title;
      return caption?.isTex ? [{ tex: caption.text, line: element.line }] : [];
    }),
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
