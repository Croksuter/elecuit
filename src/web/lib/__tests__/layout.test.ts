// role: checks that drawings keep nets apart, name every loose piece, and stay compact.
// cell: T1/unit

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { labelBox, overlaps } from "../drawing";
import type { Box, Drawing, Primitive } from "../drawing";
import { layout } from "../layout";
import { parse } from "../netlist";
import type { Device } from "../netlist";
import { assignLevels } from "../network";
import { EXAMPLE } from "../prompt";

type Segment = { net: string; box: Box };

const ALU = readFileSync(new URL("./fixtures/alu.txt", import.meta.url), "utf8");

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
      const [x1, y1] = point;
      return {
        net: primitive.net,
        box: {
          x0: Math.min(x0, x1),
          y0: Math.min(y0, y1),
          x1: Math.max(x0, x1),
          y1: Math.max(y0, y1),
        },
      };
    });
  });
}

// Segments touch when their closed extents share a point.
function touches(left: Segment, right: Segment): boolean {
  return overlaps(left.box, right.box, 1e-9);
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

// A net drawn as several separate pieces of wire is still one net only if every piece shows the
// net's name. Returns the nets with a piece that shows none. GND pieces end in the ground symbol.
function unnamedPieces(drawing: Drawing): string[] {
  const segments = segmentsOf(drawing.primitives);
  const labels = drawing.primitives.filter((primitive) => primitive.type === "label");
  const unnamed: string[] = [];
  for (const net of new Set(segments.map((segment) => segment.net))) {
    if (net === "GND") continue;
    const pieces: Segment[][] = [];
    for (const segment of segments.filter((entry) => entry.net === net)) {
      const joined = pieces.filter((piece) => piece.some((member) => touches(member, segment)));
      for (const piece of joined) pieces.splice(pieces.indexOf(piece), 1);
      pieces.push([segment, ...joined.flat()]);
    }
    if (pieces.length < 2) continue;
    const isNamed = (piece: Segment[]): boolean =>
      labels.some(
        (label) =>
          label.net === net && piece.some((member) => overlaps(member.box, labelBox(label), 16)),
      );
    if (!pieces.every(isNamed)) unnamed.push(net);
  }
  return unnamed;
}

function devicesOf(text: string): Device[] {
  return parse(text).circuit.elements.filter((element) => element.type === "device");
}

function levelsOf(text: string): Record<string, number> {
  const devices = devicesOf(text);
  const nodes = [...new Set(devices.flatMap((device) => device.pins.map((pin) => pin.net)))].filter(
    (net) => !["VDD", "VCC", "GND", "VSS", "VEE"].includes(net),
  );
  return Object.fromEntries(assignLevels(devices, nodes));
}

const CIRCUITS: Record<string, string> = {
  "domino with precharge": EXAMPLE,
  "static nand": `input A B
output Y
pmos PA g=A d=Y s=VDD
pmos PB g=B d=Y s=VDD
nmos NA g=A d=Y s=n1
nmos NB g=B d=n1 s=GND
`,
  "gate chain": `input A B C
output Z
nand G1 in=A,B out=n1
nor G2 in=n1,C out=n2
inv G3 in=n2 out=Z
cap CL a=Z b=GND value=$C_L$
`,
  "pass transistor": `input A EN
nmos M1 g=EN d=A s=Y
pmos P1 g=Y d=W s=VDD
nmos N1 g=Y d=W s=GND
`,
  "transistor bridge": `nmos M1 g=A d=VDD s=a
nmos M2 g=A d=VDD s=b
nmos M3 g=A d=a s=b
nmos M4 g=A d=a s=GND
nmos M5 g=A d=b s=GND
`,
  "multifunction ALU": ALU,
  "RLC low-pass": `vsrc V1 p=in n=GND value=$v_s$
res R1 a=in b=n1 value=$R$
ind L1 a=n1 b=out value=$L$
cap C1 a=out b=GND value=$C$
`,
  "common-emitter amplifier": `res R1 a=VCC b=base value=$R_1$
res R2 a=base b=GND value=$R_2$
res RC a=VCC b=col value=$R_C$
res RE a=emit b=GND value=$R_E$
cap CE a=emit b=GND value=$C_E$
npn Q1 b=base c=col e=emit
cap Cin a=in b=base
vsrc Vin p=in n=GND value=$v_{in}$
cap Cout a=col b=out
res RL a=out b=GND value=$R_L$
`,
  "wheatstone bridge": `vsrc V1 p=top n=GND
res R1 a=top b=l
res R2 a=top b=r
res R3 a=l b=GND
res R4 a=r b=GND
res R5 a=l b=r
`,
  "diode bridge rectifier": `vsrc Vs p=p n=n value=$v_s$
diode D1 a=p k=o
diode D2 a=n k=o
diode D3 a=GND k=p
diode D4 a=GND k=n
res RL a=o b=GND
cap CL a=o b=GND
`,
  "transmission gate and DRAM cell": `nmos TN g=EN d=A s=B
pmos TP g=ENB d=A s=B
nmos MA g=WL d=BL s=store
cap CS a=store b=GND value=$C_S$
`,
  "current mirror and op-amp": `isrc IREF p=VDD n=ref value=$I_{ref}$
nmos M1 g=ref d=ref s=GND
nmos M2 g=ref d=out s=GND
res RL a=VDD b=out
res RI a=vin b=minus value=$R_1$
res RF a=minus b=vout value=$R_2$
opamp U1 p=GND n=minus out=vout
`,
  "flip-flop, mux and a latch loop": `mux MX in=D0,D1 sel=S out=d
dff FF d=d clk=CLK q=Q qb=QB
nor G1 in=R,QN out=QL
nor G2 in=S2,QL out=QN
xor G3 in=Q,QL out=E
block ADC in=E out=b0,b1 title=$\\text{ADC}$
led D1 a=b0 k=k1
res R1 a=k1 b=GND value=330
zener Z1 a=GND k=b1
switch S1 a=VCC b=S2
pnp Q2 b=b1 c=VEE e=VCC
`,
};

describe("layout", () => {
  it.each(Object.entries(CIRCUITS))("keeps every net's wires apart in %s", (_name, text) => {
    const drawing = draw(text);
    expect(drawing.primitives.length).toBeGreaterThan(0);
    expect(foreignContacts(drawing)).toEqual([]);
  });

  it.each(Object.entries(CIRCUITS))("names every separate piece of a net in %s", (_name, text) => {
    expect(unnamedPieces(draw(text))).toEqual([]);
  });

  it("wires Y from the stack into the inverter and names the inverter's output", () => {
    const drawing = draw(EXAMPLE);
    const labels = drawing.primitives.filter((primitive) => primitive.type === "label");
    expect(labels.filter((label) => label.net === "Y")).toHaveLength(1);
    expect(labels.some((label) => label.net === "Z")).toBe(true);
    expect(drawing.notes).toEqual([]);
  });

  it("spreads a large gate network over columns instead of one long row", () => {
    const drawing = draw(ALU);
    // One row of these 60 elements was about forty times wider than tall.
    expect(drawing.width / drawing.height).toBeLessThan(4);
  });
});

// A fixed sequence of pseudo-random circuits: devices and gates wired to a small pool of nodes, so
// loops, bridges, parallel pairs and rail-to-rail devices all turn up.
function randomCircuit(seed: number): string {
  let state = seed;
  function next(limit: number): number {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor((state / 2147483648) * limit);
  }
  const pool = ["VDD", "GND", "VSS", "a", "b", "c", "d", "e", "f"];
  const net = (): string => pool[next(pool.length)];
  const lines: string[] = [];
  const deviceCount = 2 + next(12);
  for (let index = 0; index < deviceCount; index++) {
    const kind = ["nmos", "pmos", "npn", "res", "cap", "ind", "diode", "vsrc", "isrc"][next(9)];
    if (kind === "nmos" || kind === "pmos")
      lines.push(`${kind} M${index} g=${net()} d=${net()} s=${net()}`);
    else if (kind === "npn") lines.push(`npn Q${index} b=${net()} c=${net()} e=${net()}`);
    else if (kind === "diode") lines.push(`diode D${index} a=${net()} k=${net()}`);
    else if (kind === "vsrc" || kind === "isrc")
      lines.push(`${kind} S${index} p=${net()} n=${net()}`);
    else lines.push(`${kind} E${index} a=${net()} b=${net()} value=$x_{${index}}$`);
  }
  const gateCount = next(8);
  for (let index = 0; index < gateCount; index++) {
    const inputs = [net(), net(), `g${next(gateCount)}`].slice(0, 2 + next(2));
    lines.push(`${["nand", "nor", "xor"][next(3)]} G${index} in=${inputs.join(",")} out=g${index}`);
  }
  if (next(2) === 0) lines.push(`opamp U1 p=${net()} n=a out=u1`, "res RF a=a b=u1");
  return lines.join("\n");
}

describe("layout of random circuits", () => {
  it("keeps nets apart and names every piece in 150 generated circuits", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const text = randomCircuit(seed);
      const drawing = layout(parse(text).circuit, measure);
      expect(foreignContacts(drawing), text).toEqual([]);
      expect(unnamedPieces(drawing), text).toEqual([]);
    }
  });
});

describe("assignLevels", () => {
  it("stacks a pull-down chain below its output and keeps both precharged nodes on one line", () => {
    const levels = levelsOf(ALU);
    expect(levels.Y).toBeLessThan(levels.X1N);
    expect(levels.X1N).toBe(levels.X2N);
    expect(levels.X1N).toBeLessThan(levels.TAIL);
  });

  it("lays series elements flat when only a capacitor separates them from ground", () => {
    const levels = levelsOf(CIRCUITS["RLC low-pass"]);
    expect(levels.in).toBe(levels.n1);
    expect(levels.n1).toBe(levels.out);
  });

  it("puts the two mid nodes of a bridge on one line below the supplied node", () => {
    const levels = levelsOf(CIRCUITS["wheatstone bridge"]);
    expect(levels.l).toBe(levels.r);
    expect(levels.top).toBeLessThan(levels.l);
  });
});
