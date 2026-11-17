// role: works out the logic level of every net for chosen input levels: gates, flip-flops, MOS switches.

import type { Block, Circuit, Device, Rails } from "./netlist";

// null means unknown: the level cannot be told from what is known.
type Level = 0 | 1 | null;
type Strength = "strong" | "weak";

// A path between two nets that conducts or not: a MOS channel, or a resistor that always does.
interface Link {
  ends: [string, string];
  strength: Strength;
  isOn: boolean | null;
}

interface Memory {
  q: Level;
  clock: Level;
}

// Devices whose effect on a net is not a matter of 0 and 1; a net they touch is unknown unless
// something digital drives it.
const ANALOG_KINDS: Device["kind"][] = [
  "npn",
  "pnp",
  "ind",
  "switch",
  "diode",
  "zener",
  "led",
  "vsrc",
  "isrc",
];
const STRENGTHS: Strength[] = ["strong", "weak"];

function invert(level: Level): Level {
  return level === null ? null : level === 1 ? 0 : 1;
}

function evaluateGate(kind: Block["kind"], inputs: Level[]): Level {
  switch (kind) {
    case "buf":
      return inputs[0];
    case "inv":
      return invert(inputs[0]);
    case "and":
    case "nand": {
      const all = inputs.includes(0) ? 0 : inputs.includes(null) ? null : 1;
      return kind === "and" ? all : invert(all);
    }
    case "or":
    case "nor": {
      const any = inputs.includes(1) ? 1 : inputs.includes(null) ? null : 0;
      return kind === "or" ? any : invert(any);
    }
    case "xor":
    case "xnor": {
      if (inputs.includes(null)) return null;
      const odd = (inputs.filter((level) => level === 1).length % 2) as 0 | 1;
      return kind === "xor" ? odd : invert(odd);
    }
    default:
      return null;
  }
}

// Holds the circuit's state between input changes: stored charge on undriven nets and the
// contents of flip-flops and latches.
class Simulator {
  // The nets a user may set, in the order the netlist first names them.
  readonly inputs: string[];

  private readonly rails: Rails;
  private readonly devices: Device[];
  private readonly blocks: Block[];
  private readonly nets: string[];
  private readonly analogNets: Set<string>;
  private readonly assigned = new Map<string, 0 | 1>();
  private readonly memory = new Map<string, Memory>();
  private values = new Map<string, Level>();
  // Undriven nets whose level was lost when they shared charge with a net at the other level.
  private readonly shared = new Set<string>();
  // Nets that paths at 0 and at 1 both drive for certain, as of the last pass.
  private fought = new Set<string>();

  constructor(circuit: Circuit) {
    this.rails = circuit.rails;
    this.devices = circuit.elements.filter((element) => element.type === "device");
    this.blocks = circuit.elements.filter((element) => element.type === "block");
    const pinNets = this.devices.flatMap((device) => device.pins.map((pin) => pin.net));
    const readNets = [
      ...this.devices.flatMap((device) => (device.control === null ? [] : [device.control.net])),
      ...this.blocks.flatMap((block) => block.inputs.map((input) => input.net)),
    ];
    const driven = new Set(
      this.blocks.flatMap((block) => block.outputs.map((output) => output.net)),
    );
    this.nets = [...new Set([...pinNets, ...readNets, ...driven])].filter(
      (net) => !this.rails.has(net),
    );
    this.analogNets = new Set(
      this.devices
        .filter((device) => ANALOG_KINDS.includes(device.kind))
        .flatMap((device) => device.pins.map((pin) => pin.net)),
    );
    // A net is an input when the netlist declares it, or when it is only ever read.
    const declared = circuit.inputs.map((entry) => entry.net);
    const onlyRead = readNets.filter((net) => !pinNets.includes(net));
    this.inputs = [...new Set([...declared, ...onlyRead])].filter(
      (net) => !this.rails.has(net) && !driven.has(net) && !this.analogNets.has(net),
    );
    this.settle();
  }

  levelOf(net: string): Level {
    if (this.rails.isPower(net)) return 1;
    if (this.rails.isGround(net)) return 0;
    return this.assigned.get(net) ?? this.values.get(net) ?? null;
  }

  // Whether the net is unknown because paths at 0 and at 1 both drive it.
  isFoughtOver(net: string): boolean {
    return this.fought.has(net);
  }

  // Whether the net is unknown because it shared its charge with a net at the other level.
  lostToSharing(net: string): boolean {
    return this.shared.has(net);
  }

  // Whether a MOS device conducts, or null when its gate is unknown or it is not a MOS device.
  conducts(device: Device): boolean | null {
    if (device.kind !== "nmos" && device.kind !== "pmos") return null;
    const gate = this.levelOf(device.control!.net);
    if (gate === null) return null;
    return (gate === 1) === (device.kind === "nmos");
  }

  // Sets an input (null releases it) and lets the circuit settle.
  set(net: string, level: Level): void {
    if (!this.inputs.includes(net)) throw new Error(`simulate: ${net} is not an input`);
    if (level === null) this.assigned.delete(net);
    else this.assigned.set(net, level);
    this.settle();
  }

  // Releases every input and forgets stored charge and flip-flop contents.
  reset(): void {
    this.assigned.clear();
    this.memory.clear();
    this.shared.clear();
    this.values = new Map();
    this.settle();
  }

  private settle(): void {
    const before = new Map(this.values);
    const limit = 20 + 4 * (this.devices.length + this.blocks.length);
    // A net that will not settle (a ring of inverters) is held unknown so the rest can.
    const unstable = new Set<string>();
    for (let round = 0; round < 2 * limit; round++) {
      const next = this.sweep(before);
      const changed = this.nets.filter(
        (net) => (next.get(net) ?? null) !== (this.values.get(net) ?? null),
      );
      if (round >= limit) changed.forEach((net) => unstable.add(net));
      for (const net of unstable) next.set(net, null);
      this.values = next;
      if (changed.length === 0) return;
    }
  }

  // One pass: block outputs from the current levels, then every other net from what reaches it.
  private sweep(before: Map<string, Level>): Map<string, Level> {
    const sources = new Map<string, Level>();
    for (const net of this.analogNets) sources.set(net, null);
    for (const block of this.blocks) {
      for (const [net, level] of this.outputsOf(block, before)) sources.set(net, level);
    }
    // An input nobody has set is unknown; it is not an undriven node that keeps its last level.
    for (const net of this.inputs) sources.set(net, this.assigned.get(net) ?? null);

    const links: Link[] = this.devices.flatMap((device): Link[] => {
      const ends = device.pins.map((pin) => pin.net) as [string, string];
      if (device.kind === "res") return [{ ends, strength: "weak", isOn: true }];
      if (device.kind !== "nmos" && device.kind !== "pmos") return [];
      return [{ ends, strength: device.isWeak ? "weak" : "strong", isOn: this.conducts(device) }];
    });
    const isSource = (net: string): boolean => this.rails.has(net) || sources.has(net);
    const sourceLevel = (net: string): Level =>
      this.rails.isPower(net) ? 1 : this.rails.isGround(net) ? 0 : (sources.get(net) ?? null);
    const allNets = [...new Set([...this.nets, ...links.flatMap((link) => link.ends)])];

    // The nets a level spreads to from `starts` across the links that `crosses` allows; a level
    // never spreads through a net that something else drives.
    function reach(starts: string[], crosses: (link: Link) => boolean): Set<string> {
      const seen = new Set(starts);
      const queue = [...starts];
      while (queue.length > 0) {
        const net = queue.pop()!;
        for (const link of links) {
          if (!link.ends.includes(net) || !crosses(link)) continue;
          const other = link.ends[0] === net ? link.ends[1] : link.ends[0];
          if (seen.has(other) || isSource(other)) continue;
          seen.add(other);
          queue.push(other);
        }
      }
      return seen;
    }

    const driving = allNets.filter(isSource);
    const reached = STRENGTHS.map((strength) => {
      const isStrongEnough = (link: Link): boolean =>
        strength === "weak" || link.strength === "strong";
      const from = (level: 0 | 1, isSure: boolean): Set<string> =>
        reach(
          driving.filter(
            (net) => sourceLevel(net) === level || (!isSure && sourceLevel(net) === null),
          ),
          (link) => isStrongEnough(link) && (isSure ? link.isOn === true : link.isOn !== false),
        );
      return { sure: [from(0, true), from(1, true)], maybe: [from(0, false), from(1, false)] };
    });

    const next = new Map<string, Level>();
    const fought = new Set<string>();
    for (const net of this.nets) {
      if (isSource(net)) {
        next.set(net, sourceLevel(net));
        continue;
      }
      let level: Level | undefined;
      for (const { sure, maybe } of reached) {
        const [sure0, sure1] = [sure[0].has(net), sure[1].has(net)];
        const [maybe0, maybe1] = [maybe[0].has(net), maybe[1].has(net)];
        if (!maybe0 && !maybe1) continue;
        // Driven at this strength: one level for certain and the other ruled out, else unknown.
        level = sure0 && !maybe1 ? 0 : sure1 && !maybe0 ? 1 : null;
        if (sure0 && sure1) fought.add(net);
        break;
      }
      if (level === undefined) {
        // Nothing drives the net: it keeps its charge, unless it shares it with a net that holds
        // a different level.
        const held = this.values.get(net) ?? null;
        const sharing = [...reach([net], (link) => link.isOn !== false)];
        const others = sharing.map((other) => this.values.get(other) ?? null);
        level = others.every((other) => other === held) ? held : null;
        if (others.includes(0) && others.includes(1))
          sharing.forEach((other) => this.shared.add(other));
        if (level === null && this.shared.has(net)) {
          next.set(net, null);
          continue;
        }
      }
      this.shared.delete(net);
      next.set(net, level);
    }
    this.fought = fought;
    return next;
  }

  private outputsOf(block: Block, before: Map<string, Level>): [string, Level][] {
    const read = (key: string): Level[] =>
      block.inputs.filter((input) => input.key === key).map((input) => this.levelOf(input.net));
    const { kind } = block;

    if (kind === "mux") {
      const data = read("in");
      const select = read("sel");
      let level: Level;
      if (select.includes(null)) level = data.every((entry) => entry === data[0]) ? data[0] : null;
      else
        level =
          data[select.reduce<number>((sum, bit, index) => sum + bit! * 2 ** index, 0)] ?? null;
      return [[block.outputs[0].net, level]];
    }

    if (kind === "dff" || kind === "latch") {
      const state = this.memory.get(block.name) ?? { q: null, clock: null };
      this.memory.set(block.name, state);
      const [data] = read("d");
      if (kind === "latch") {
        const [enable] = read("en");
        if (enable === 1) state.q = data;
        else if (enable === null && data !== state.q) state.q = null;
      } else {
        const [clock] = read("clk");
        // The flip-flop takes the level its input had before this change reached the clock.
        const input = block.inputs.find((entry) => entry.key === "d")!.net;
        const sampled =
          this.rails.has(input) || this.assigned.has(input) ? data : (before.get(input) ?? null);
        const isEdge = state.clock === 0 && clock === 1;
        const isMaybeEdge =
          (state.clock === null && clock === 1) || (state.clock === 0 && clock === null);
        if (isEdge) state.q = sampled;
        else if (isMaybeEdge && sampled !== state.q) state.q = null;
        state.clock = clock;
        const [reset] = read("rst");
        const [preset] = read("set");
        if (reset === 1) state.q = 0;
        else if (preset === 1) state.q = 1;
        else if ((reset === null && state.q !== 0) || (preset === null && state.q !== 1))
          state.q = null;
      }
      return block.outputs.map((output) => [
        output.net,
        output.key === "qb" ? invert(state.q) : state.q,
      ]);
    }

    if (kind === "opamp" || kind === "block")
      return block.outputs.map((output) => [output.net, null]);
    return [[block.outputs[0].net, evaluateGate(kind, read("in"))]];
  }
}

export type { Level };
export { Simulator };
