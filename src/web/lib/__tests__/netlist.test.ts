// role: checks netlist parsing and connection lint against known good and broken inputs.
// cell: T1/unit

import { describe, expect, it } from "vitest";

import { lint } from "../lint";
import { parse } from "../netlist";
import { version } from "../../../../package.json";
import { canvasPrompt, EMBED_SCRIPT_URL, EXAMPLE } from "../prompt";

function messages(text: string): string[] {
  const { circuit, diagnostics } = parse(text);
  return [...diagnostics, ...lint(circuit)].map(
    (entry) => `${entry.line}:${entry.severity}:${entry.message}`,
  );
}

describe("parse", () => {
  it("reads the example without diagnostics", () => {
    const { circuit, diagnostics } = parse(EXAMPLE);
    expect(diagnostics).toEqual([]);
    expect(lint(circuit)).toEqual([]);
    expect(circuit.elements.map((element) => element.name)).toEqual([
      "P1",
      "N1",
      "N2",
      "N3",
      "P2",
      "I1",
    ]);
    expect(circuit.labels.get("phi")?.tex).toBe("\\phi");
  });

  it("reads only the elecuit fence of a pasted answer and keeps line numbers", () => {
    const answer = [
      "설명입니다.",
      "```text",
      "아무거나",
      "```",
      "```elecuit",
      "nmos N1 g=A d=Y",
      "```",
    ].join("\n");
    expect(messages(answer)).toEqual(["6:error:N1: 단자 s가 없습니다."]);
  });

  it("reports malformed lines", () => {
    const text = [
      "nmos N1 g=$A$ d=Y s=GND",
      "pmos P1 g=A d=Y s=VDD q=1",
      "resistor R1 a=Y b=GND",
      "nmos P1 g=A d=Y s=GND",
      "label Y \\phi",
      "inv I1 in=A,B out=Z",
    ].join("\n");
    const result = messages(text);
    expect(result[0]).toContain("1:error:N1.g: 노드 이름에는 $…$를 쓸 수 없습니다");
    expect(result[1]).toContain('2:error:P1: 알 수 없는 단자 "q"');
    expect(result[2]).toContain('3:error:알 수 없는 줄 "resistor"');
    expect(result[3]).toContain("4:error:소자 이름 P1이 2행과 겹칩니다");
    expect(result[4]).toContain("5:error:label: 표시 이름은 $…$로 감싼");
    expect(result[5]).toContain("6:error:I1: inv는 입력이 하나입니다");
  });
});

describe("lint", () => {
  it("points at a case typo between nodes", () => {
    const text = ["nmos N1 g=A d=Y s=X", "nmos N2 g=B d=X s=GND", "pmos P2 g=A d=x s=VDD"].join(
      "\n",
    );
    expect(messages(text)).toContain(
      "3:warning:P2.d: 노드 x는 한 곳에서만 쓰입니다. X의 오타인가요?",
    );
  });

  it("rejects two drivers on one output and unreadable KaTeX", () => {
    const text = ["input A", "inv I1 in=A out=Z", "inv I2 in=A out=Z", "label Z $\\frac{1$"].join(
      "\n",
    );
    const result = messages(text);
    expect(result).toContain("3:error:I2: 출력 Z를 I1도 구동합니다.");
    expect(result.some((entry) => entry.startsWith("4:error:KaTeX 수식"))).toBe(true);
  });
});

describe("canvasPrompt", () => {
  it("gives a template whose netlist block is clean and whose script comes last", () => {
    const prompt = canvasPrompt("https://example.test/elecuit.js");
    const block = /<script type="text\/elecuit">\n([\s\S]*?)<\/script>/.exec(prompt);
    expect(block).not.toBeNull();
    expect(messages(block![1])).toEqual([]);
    expect(prompt.indexOf('<script src="https://example.test/elecuit.js">')).toBeGreaterThan(
      block!.index,
    );
  });

  it("pins the bundle address to the exact package version", () => {
    expect(EMBED_SCRIPT_URL).toBe(
      `https://cdn.jsdelivr.net/gh/Croksuter/elecuit@${version}/dist/elecuit.js`,
    );
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
