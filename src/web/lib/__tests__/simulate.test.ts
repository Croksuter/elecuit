// role: checks the logic levels the simulator gives for gates, MOS networks, dynamic nodes and memory.
// cell: T1/unit

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parse } from "../netlist";
import { EXAMPLE } from "../prompt";
import { Simulator } from "../simulate";
import type { Level } from "../simulate";

const ALU = readFileSync(new URL("./fixtures/alu.txt", import.meta.url), "utf8");
const ALU_MUX = readFileSync(new URL("./fixtures/alu-mux.txt", import.meta.url), "utf8");

// The domino gate of the example without the transistor that precharges X.
const DOMINO = `input A B phi
pmos P1 g=phi d=Y  s=VDD
nmos N1 g=A   d=Y  s=X
nmos N2 g=B   d=X  s=n1
nmos N3 g=phi d=n1 s=GND
inv  I1 in=Y  out=Z
`;

function simulate(text: string): Simulator {
  const { circuit, diagnostics } = parse(text);
  expect(diagnostics).toEqual([]);
  return new Simulator(circuit);
}

// Applies `net=level` steps in order, each one settling before the next.
function apply(simulator: Simulator, steps: string): void {
  for (const step of steps.split(/\s+/).filter(Boolean)) {
    const [net, level] = step.split("=");
    simulator.set(net, level === "x" ? null : (Number(level) as 0 | 1));
  }
}

function levels(simulator: Simulator, nets: string): Level[] {
  return nets.split(/\s+/).map((net) => simulator.levelOf(net));
}

describe("Simulator", () => {
  it("offers declared inputs and nets that are only read, never driven ones", () => {
    expect(simulate(EXAMPLE).inputs).toEqual(["A", "B", "phi"]);
    expect(
      simulate("nand G1 in=A,B out=n1\ninv G2 in=n1 out=Y\nnmos M1 g=EN d=D s=Y").inputs,
    ).toEqual(["EN", "A", "B"]);
  });

  it("evaluates gates with unknown inputs as far as the known ones decide", () => {
    const simulator = simulate("and G1 in=A,B out=n1\nxor G2 in=n1,C out=Y\nor G3 in=A,C out=W");
    expect(levels(simulator, "n1 Y W")).toEqual([null, null, null]);
    apply(simulator, "A=0");
    expect(levels(simulator, "n1 Y W")).toEqual([0, null, null]);
    apply(simulator, "C=1");
    expect(levels(simulator, "n1 Y W")).toEqual([0, 1, 1]);
    apply(simulator, "A=1 B=1");
    expect(levels(simulator, "n1 Y W")).toEqual([1, 0, 1]);
  });

  it("follows a static CMOS NAND through all four input pairs", () => {
    const simulator = simulate(`pmos PA g=A d=Y s=VDD
pmos PB g=B d=Y s=VDD
nmos NA g=A d=Y s=n1
nmos NB g=B d=n1 s=GND`);
    for (const [a, b, y] of [
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ]) {
      apply(simulator, `A=${a} B=${b}`);
      expect(simulator.levelOf("Y")).toBe(y);
    }
  });

  it("precharges, evaluates and then holds a domino node", () => {
    const simulator = simulate(EXAMPLE);
    apply(simulator, "A=1 B=1 phi=0");
    expect(levels(simulator, "Y Z")).toEqual([1, 0]);
    apply(simulator, "phi=1");
    expect(levels(simulator, "Y Z")).toEqual([0, 1]);
    apply(simulator, "phi=0 A=0 phi=1");
    expect(levels(simulator, "Y Z")).toEqual([1, 0]);
  });

  it("loses the domino node to charge sharing unless X is precharged too", () => {
    // Discharge X, precharge Y alone, then open N1 while nothing pulls down.
    const steps = "A=1 B=1 phi=0 phi=1 A=0 phi=0 B=0 phi=1 A=1";
    const plain = simulate(DOMINO);
    apply(plain, steps);
    expect(levels(plain, "Y Z")).toEqual([null, null]);
    expect(plain.lostToSharing("Y")).toBe(true);
    expect(plain.lostToSharing("Z")).toBe(false);
    apply(plain, "phi=0");
    expect(plain.lostToSharing("Y")).toBe(false);
    const precharged = simulate(EXAMPLE);
    apply(precharged, steps);
    expect(levels(precharged, "Y X Z")).toEqual([1, 1, 0]);
  });

  it("takes a keeper as weak, written so or not, and lets other pull-ups fight", () => {
    const steps = "A=1 B=1 phi=0 phi=1";
    for (const keeper of ["pmos PK g=Z d=Y s=VDD weak", "pmos PK g=Z d=Y s=VDD"]) {
      const simulator = simulate(`${DOMINO}${keeper}`);
      apply(simulator, steps);
      expect(levels(simulator, "Y Z")).toEqual([0, 1]);
      apply(simulator, "phi=0 A=0 phi=1");
      expect(levels(simulator, "Y Z")).toEqual([1, 0]);
    }
    // A pull-up that stays on whatever Y does is no keeper: it fights the pull-down.
    const fighting = simulate(`${DOMINO}pmos PU g=EN d=Y s=VDD`);
    apply(fighting, `EN=0 ${steps}`);
    expect(fighting.levelOf("Y")).toBeNull();
    expect(fighting.isFoughtOver("Y")).toBe(true);
  });

  it("finds a keeper whose inverter is written as two transistors", () => {
    const simulator = simulate(`input A B phi
pmos P1 g=phi d=Y s=VDD
nmos N1 g=A d=Y s=X
nmos N2 g=B d=X s=n1
nmos N3 g=phi d=n1 s=GND
pmos PI g=Y d=Z s=VDD
nmos NI g=Y d=Z s=GND
pmos PK g=Z d=Y s=VDD`);
    apply(simulator, "A=1 B=1 phi=0 phi=1");
    expect(levels(simulator, "Y Z")).toEqual([0, 1]);
  });

  it("forgets what an input decided once the input is released", () => {
    const simulator = simulate("and G1 in=A,B out=n1\ninv G2 in=n1 out=Y");
    apply(simulator, "A=1 B=1");
    expect(levels(simulator, "A n1 Y")).toEqual([1, 1, 0]);
    apply(simulator, "A=x");
    expect(levels(simulator, "A n1 Y")).toEqual([null, null, null]);
    apply(simulator, "B=0");
    expect(levels(simulator, "A n1 Y")).toEqual([null, 0, 1]);
  });

  it("pulls a node up through a resistor until a transistor pulls it down", () => {
    const simulator = simulate("res R1 a=VDD b=Y\nnmos M1 g=A d=Y s=GND");
    apply(simulator, "A=0");
    expect(simulator.levelOf("Y")).toBe(1);
    apply(simulator, "A=1");
    expect(simulator.levelOf("Y")).toBe(0);
  });

  it("clocks a flip-flop on the rising edge only and selects through a mux", () => {
    const simulator = simulate("mux MX in=D0,D1 sel=S out=d\ndff FF d=d clk=CLK q=Q qb=QB");
    apply(simulator, "D0=1 D1=0 S=0 CLK=0 CLK=1");
    expect(levels(simulator, "d Q QB")).toEqual([1, 1, 0]);
    apply(simulator, "S=1");
    expect(levels(simulator, "d Q")).toEqual([0, 1]);
    apply(simulator, "CLK=0");
    expect(simulator.levelOf("Q")).toBe(1);
    apply(simulator, "CLK=1");
    expect(levels(simulator, "Q QB")).toEqual([0, 1]);
  });

  it("sets, holds and resets a latch made of two NOR gates", () => {
    const simulator = simulate("nor G1 in=R,QN out=Q\nnor G2 in=S,Q out=QN");
    apply(simulator, "S=0 R=0");
    expect(simulator.levelOf("Q")).toBeNull();
    apply(simulator, "S=1");
    expect(levels(simulator, "Q QN")).toEqual([1, 0]);
    apply(simulator, "S=0");
    expect(levels(simulator, "Q QN")).toEqual([1, 0]);
    apply(simulator, "R=1");
    expect(levels(simulator, "Q QN")).toEqual([0, 1]);
  });

  it("marks a ring that cannot settle as unknown instead of running forever", () => {
    const simulator = simulate("nand G1 in=EN,c out=a\ninv G2 in=a out=b\ninv G3 in=b out=c");
    apply(simulator, "EN=0");
    expect(levels(simulator, "a b c")).toEqual([1, 0, 1]);
    apply(simulator, "EN=1");
    expect(levels(simulator, "a b c")).toEqual([null, null, null]);
  });

  it("leaves a net unknown where only an analog device sets it", () => {
    const simulator = simulate("npn Q1 b=A c=Y e=GND\nres R1 a=VCC b=Y\ninv G1 in=Y out=Z");
    apply(simulator, "A=1");
    expect(levels(simulator, "Y Z")).toEqual([null, null]);
  });

  it("adds and carries in the ALU as its author wrote it", () => {
    const simulator = simulate(ALU);
    apply(simulator, "A=1 B=1 CI=0 S2=0 S1=0 S0=1 phi=0");
    expect(levels(simulator, "SUM CO F")).toEqual([0, 0, 1]);
    apply(simulator, "phi=1");
    expect(simulator.levelOf("CO")).toBe(1);
    apply(simulator, "S1=1");
    expect(levels(simulator, "XAB F")).toEqual([0, 0]);
  });

  it("matches every output of the multiplexer ALU for all 64 input sets", () => {
    const simulator = simulate(ALU_MUX);
    const wrong: string[] = [];
    for (let set = 0; set < 64; set++) {
      const [a, b, ci, s0, s1, s2] = [0, 1, 2, 3, 4, 5].map((bit) => (set >> bit) & 1);
      apply(simulator, `phi=0 CLK=0 EN=0 A=${a} B=${b} CI=${ci} S0=${s0} S1=${s1} S2=${s2}`);
      if (simulator.levelOf("Y") !== 1 || simulator.levelOf("CO") !== 0)
        wrong.push(`${set}: precharge`);
      apply(simulator, "phi=1 CLK=1 EN=1");
      const xor = a ^ b;
      const selected = [1 - a, a & b, a | b, xor, 1 - (a & b), 1 - (a | b), 1 - xor, xor ^ ci][
        s0 + 2 * s1 + 4 * s2
      ];
      const expected = {
        F: selected,
        Q: selected,
        L: selected,
        SUM: xor ^ ci,
        CO: (a & b) | (ci & xor),
        EQ: 1 - xor,
      };
      for (const [net, level] of Object.entries(expected)) {
        if (simulator.levelOf(net) !== level) wrong.push(`${set}: ${net}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
