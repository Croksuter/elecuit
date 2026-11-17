// role: checks netlist parsing and connection lint against known good and broken inputs.
// cell: T1/unit

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { lint } from "../lint";
import { parse } from "../netlist";
import { version } from "../../../../package.json";
import {
  canvasPrompt,
  EMBED_SCRIPT_URL,
  EXAMPLE,
  LATEST_DOCUMENT_URL,
  promptDocument,
} from "../prompt";

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

  it("reads analog devices, blocks and values written without $", () => {
    const text = [
      "res R1 a=VCC b=out value=10k",
      "npn Q1 b=in c=out e=GND",
      "opamp U1 p=GND n=in out=out2",
      "dff FF d=out2 clk=CLK q=Q",
      "block ADC in=Q out=b0,b1 title=$\\text{ADC}$",
    ].join("\n");
    const { circuit, diagnostics } = parse(text);
    expect(diagnostics).toEqual([]);
    const [resistor, transistor, , , box] = circuit.elements;
    expect(resistor).toMatchObject({ kind: "res", value: { text: "10k", isTex: false } });
    expect(transistor).toMatchObject({
      control: { key: "b", net: "in" },
      pins: [
        { key: "c", net: "out" },
        { key: "e", net: "GND" },
      ],
    });
    expect(box).toMatchObject({
      outputs: [
        { key: "out", net: "b0" },
        { key: "out", net: "b1" },
      ],
      title: { text: "\\text{ADC}", isTex: true },
    });
  });

  it("reports blocks and values that do not fit their form", () => {
    const result = messages(
      [
        "opamp U1 p=A out=Y",
        "dff F1 d=A,B clk=C q=Q",
        "block B1",
        "res R1 a=A b=B value=$x$y",
        "nand G1 in=A,B out=VCC",
      ].join("\n"),
    );
    expect(result[0]).toBe("1:error:U1: 단자 n가 없습니다.");
    expect(result[1]).toBe("2:error:F1: 단자 d에는 노드 하나만 씁니다.");
    expect(result[2]).toBe("3:error:B1: in이나 out에 노드가 하나는 있어야 합니다.");
    expect(result[3]).toBe("4:error:R1: value의 수식은 $…$로 감싸야 합니다.");
    expect(result[4]).toBe("5:error:G1: 출력을 VCC에 연결할 수 없습니다.");
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
    const block = /<script type="text\/elecuit" title="[^"]+">\n([\s\S]*?)<\/script>/.exec(prompt);
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

  it("keeps the README on the latest document address and the current bundle version", () => {
    const readme = readFileSync(new URL("../../../../README.md", import.meta.url), "utf8");
    const addresses = [...readme.matchAll(/https:\/\/cdn\.jsdelivr\.net\/gh\/[\w./@-]+/g)];
    expect(addresses.map((match) => match[0]).sort()).toEqual(
      [EMBED_SCRIPT_URL, LATEST_DOCUMENT_URL].sort(),
    );
  });
});

describe("promptDocument", () => {
  it("states its version, where the latest document is, and the matching bundle", () => {
    const document = promptDocument();
    expect(document).toContain(`버전: ${version}\n`);
    expect(document).toContain(`최신 문서: ${LATEST_DOCUMENT_URL}\n`);
    expect(document).toContain(`<script src="${EMBED_SCRIPT_URL}">`);
    expect(LATEST_DOCUMENT_URL).toContain("@latest/dist/prompt.md");
  });
});
