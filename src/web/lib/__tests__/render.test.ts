// role: checks that hostile netlist text and titles cannot inject markup or script links into the page.
// cell: T1/unit

import { describe, expect, it } from "vitest";

import { layout } from "../layout";
import { parse } from "../netlist";
import { render, renderTitle } from "../render";

function measure(text: string): { width: number; height: number } {
  return { width: text.length * 8, height: 16 };
}

describe("render", () => {
  it("draws no link or raw markup from label and value formulas", () => {
    const text = [
      "label A $\\href{javascript:alert(1)}{x}$",
      "label Y $\\htmlClass{evil}{y}$",
      "nmos N1 g=A d=Y s=GND",
      "cap C1 a=Y b=GND value=$\\text{<img src=x onerror=alert(1)>}$",
      "res R1 a=Y b=GND value=<img/src=x/onerror=alert(1)>",
      "block B1 in=Y title=<script>alert(1)</script>",
    ].join("\n");
    const html = render(layout(parse(text).circuit, measure));
    expect(html).not.toMatch(/<a\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/href\s*=/i);
    expect(html).not.toMatch(/class="[^"]*\bevil\b/);
  });

  it("escapes a title's words and draws its $…$ spans without links", () => {
    const html = renderTitle(
      '<img src=x onerror=alert(1)> $\\href{javascript:alert(1)}{x}$ $\\phi_1$ 비용 $5 "개선"',
    );
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<a\b/i);
    expect(html).not.toMatch(/href\s*=/i);
    expect(html).toContain('class="katex"');
    expect(html).toContain("비용 $5 &#34;개선&#34;");
  });

  it("rejects names that carry markup before they reach the sheet", () => {
    const { circuit, diagnostics } = parse('nmos <b>N1</b> g=A d="><script> s=GND');
    expect(circuit.elements).toEqual([]);
    expect(diagnostics).toHaveLength(1);
  });
});
