// role: checks that drawn wires never touch wires of another net and that stacks reduce as expected.
// cell: T1/unit

import { describe, expect, it } from "vitest";

import { layout, reduceSeriesParallel } from "../layout";
import type { Drawing, Primitive } from "../layout";
import { parse } from "../netlist";
import type { Transistor } from "../netlist";
import { EXAMPLE } from "../prompt";

type Segment = { net: string; x0: number; y0: number; x1: number; y1: number };

function measure(text: string): { width: number; height: number } {
  return { width: text.length * 8, height: 16 };
}

function draw(text: string): Drawing {
  const { circuit, diagnostics } = parse(text);
  expect(diagnostics).toEqual([]);
  return layout(circuit, measure);
}

function segmentsOf(primitives: Primitive[]): Segment[] {
  return primitives.flatMap((primitive) => {
    if (primitive.type !== "wire") return [];
    return primitive.points.slice(1).map((point, index) => {
      const [x0, y0] = primitive.points[index];
      return { net: primitive.net, x0, y0, x1: point[0], y1: point[1] };
    });
  });
}

// Axis-aligned segments touch when their closed extents overlap (shared points included).
function touches(left: Segment, right: Segment): boolean {
  const overlap = (a0: number, a1: number, b0: number, b1: number) =>
    Math.max(Math.min(a0, a1), Math.min(b0, b1)) <=
    Math.min(Math.max(a0, a1), Math.max(b0, b1)) + 1e-9;
  return (
    overlap(left.x0, left.x1, right.x0, right.x1) && overlap(left.y0, left.y1, right.y0, right.y1)
  );
}

function foreignContacts(drawing: Drawing): string[] {
  const segments = segmentsOf(drawing.primitives);
  const contacts: string[] = [];
  segments.forEach((left, index) => {
    for (const right of segments.slice(index + 1)) {
      if (left.net !== right.net && touches(left, right)) contacts.push(`${left.net}~${right.net}`);
    }
  });
  return contacts;
}

const NAND2 = `input A B
output Y
pmos PA g=A d=Y s=VDD
pmos PB g=B d=Y s=VDD
nmos NA g=A d=Y s=n1
nmos NB g=B d=n1 s=GND
`;

const GATE_CHAIN = `input A B C
output Z
nand G1 in=A,B out=n1
nor G2 in=n1,C out=n2
inv G3 in=n2 out=Z
cap CL a=Z b=GND value=$C_L$
`;

const PASS = `input A EN
nmos M1 g=EN d=A s=Y
pmos P1 g=Y d=W s=VDD
nmos N1 g=Y d=W s=GND
`;

const BRIDGE = `nmos M1 g=A d=VDD s=a
nmos M2 g=A d=VDD s=b
nmos M3 g=A d=a s=b
nmos M4 g=A d=a s=GND
nmos M5 g=A d=b s=GND
`;

describe("reduceSeriesParallel", () => {
  it("finds the precharge branch in parallel with the upper stack", () => {
    const devices = parse(EXAMPLE).circuit.elements.filter(
      (element): element is Transistor => element.kind === "nmos" || element.kind === "pmos",
    );
    const tree = reduceSeriesParallel(devices);
    expect(tree?.kind).toBe("series");
    if (tree?.kind !== "series") return;
    expect(tree.top).toBe("VDD");
    expect(tree.mids).toEqual(["X", "n1"]);
    expect(tree.children[0].kind).toBe("parallel");
  });

  it("returns null for a bridge network", () => {
    const devices = parse(BRIDGE).circuit.elements as Transistor[];
    expect(reduceSeriesParallel(devices)).toBeNull();
  });
});

describe("layout", () => {
  it.each([
    ["domino with precharge", EXAMPLE],
    ["static nand", NAND2],
    ["gate chain", GATE_CHAIN],
    ["pass transistor", PASS],
    ["bridge", BRIDGE],
  ])("keeps every net's wires apart in %s", (_name, text) => {
    const drawing = draw(text);
    expect(drawing.primitives.length).toBeGreaterThan(0);
    expect(foreignContacts(drawing)).toEqual([]);
  });

  it("wires Y straight into the inverter and labels its output", () => {
    const drawing = draw(EXAMPLE);
    expect(
      drawing.primitives.some((primitive) => primitive.type === "dot" && primitive.net === "Y"),
    ).toBe(true);
    const labels = drawing.primitives.filter((primitive) => primitive.type === "label");
    expect(labels.some((label) => label.type === "label" && label.net === "Z")).toBe(true);
    expect(drawing.notes).toEqual([]);
  });

  it("explains networks drawn device by device", () => {
    expect(draw(BRIDGE).notes[0]).toContain("M1, M2, M3, M4, M5");
  });
});
