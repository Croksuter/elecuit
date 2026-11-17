// role: draws a netlist into a stage element in the browser: label measuring, rendering, net hover, logic levels.

import { layout } from "./lib/layout";
import type { LabelKind, Measure } from "./lib/drawing";
import { collectNetUses, lint } from "./lib/lint";
import type { NetUse } from "./lib/lint";
import { parse } from "./lib/netlist";
import type { Circuit, Diagnostic } from "./lib/netlist";
import { render, renderLabelContent } from "./lib/render";
import { Simulator } from "./lib/simulate";

interface Schematic {
  circuit: Circuit;
  diagnostics: Diagnostic[];
  notes: string[];
  hasElements: boolean;
  netUses: Map<string, NetUse[]>;
}

interface LabelMeasurer {
  measure: Measure;
  reset(): void;
}

// For each stage, the names of the elements on every net of the circuit drawn there.
const elementsOn = new WeakMap<HTMLElement, Map<string, string[]>>();

// Measures labels by rendering them off-screen; sizes are cached until `reset`.
function createMeasurer(): LabelMeasurer {
  const host = document.createElement("div");
  host.className = "measure";
  document.body.append(host);
  const cache = new Map<string, { width: number; height: number }>();

  function measure(text: string, isTex: boolean, kind: LabelKind) {
    const key = `${kind}|${isTex}|${text}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const probe = document.createElement("div");
    probe.className = `label label-${kind}`;
    probe.innerHTML = renderLabelContent(text, isTex);
    host.append(probe);
    const size = { width: Math.ceil(probe.offsetWidth), height: Math.ceil(probe.offsetHeight) };
    probe.remove();
    cache.set(key, size);
    return size;
  }

  return { measure, reset: () => cache.clear() };
}

function drawSchematic(stage: HTMLElement, text: string, measure: Measure): Schematic {
  const { circuit, diagnostics: syntax } = parse(text);
  const diagnostics = [...syntax, ...lint(circuit)].sort((left, right) => left.line - right.line);
  const hasElements = circuit.elements.length > 0;
  let notes: string[] = [];
  if (hasElements) {
    const drawing = layout(circuit, measure);
    stage.innerHTML = render(drawing);
    notes = drawing.notes;
  } else {
    stage.innerHTML = "";
  }
  const netUses = collectNetUses(circuit);
  elementsOn.set(
    stage,
    new Map(
      [...netUses].map(([net, uses]) => [
        net,
        [...new Set(uses.map((use) => use.where.slice(0, use.where.indexOf("."))))],
      ]),
    ),
  );
  return { circuit, diagnostics, notes, hasElements, netUses };
}

// Lights up a net everywhere it is drawn, together with every element that has a terminal on it,
// and dims the rest of the sheet.
function highlightNet(stage: HTMLElement, net: string | null): void {
  for (const node of stage.querySelectorAll(".on")) node.classList.remove("on");
  stage.classList.toggle("focusing", net !== null);
  if (net === null) return;
  const selectors = [
    `[data-net="${CSS.escape(net)}"]`,
    ...(elementsOn.get(stage)?.get(net) ?? []).map((name) => `[data-owner="${CSS.escape(name)}"]`),
  ];
  for (const node of stage.querySelectorAll(selectors.join(","))) node.classList.add("on");
}

// Highlights the net under the pointer and reports it (null when the pointer leaves every net).
function watchNets(stage: HTMLElement, onHover: (net: string | null) => void): void {
  function set(net: string | null): void {
    highlightNet(stage, net);
    onHover(net);
  }
  stage.addEventListener("pointerover", (event) => {
    const target = (event.target as Element).closest("[data-net]");
    set(target ? target.getAttribute("data-net") : null);
  });
  stage.addEventListener("pointerleave", () => set(null));
}

function describeNet(net: string, uses: NetUse[]): string {
  return `${net} · ${uses.length}곳: ${uses.map((use) => use.where).join(", ")}`;
}

// Lets the viewer set inputs by clicking and shows the level every net settles at.
interface Logic {
  // Call after each draw. The same `source` keeps stored charge and flip-flop contents.
  load(circuit: Circuit, source: string): void;
  reset(): void;
  hasInputs(): boolean;
  // What to say about a net beside its connections; empty when there is nothing to add.
  describe(net: string): string;
}

function createLogic(stage: HTMLElement, onChange: () => void): Logic {
  let simulator: Simulator | null = null;
  let devices: Circuit["elements"] = [];
  let loaded: string | null = null;
  // The levels the viewer chose, in the order chosen; they outlive a redraw.
  const chosen = new Map<string, 0 | 1>();

  // Levels show only once the viewer has set something, so an untouched sheet stays plain.
  function paint(): void {
    if (simulator === null) return;
    const isActive = chosen.size > 0;
    for (const node of stage.querySelectorAll("[data-net]")) {
      const net = node.getAttribute("data-net")!;
      const level = isActive ? simulator.levelOf(net) : null;
      if (level === null) node.removeAttribute("data-level");
      else node.setAttribute("data-level", String(level));
      node.classList.toggle("settable", simulator.inputs.includes(net));
    }
    for (const node of stage.querySelectorAll("[data-device]")) {
      const device = devices.find((element) => element.name === node.getAttribute("data-device"));
      const state = isActive && device?.type === "device" ? simulator.conducts(device) : null;
      if (state === null) node.removeAttribute("data-state");
      else node.setAttribute("data-state", state ? "on" : "off");
    }
  }

  // A click on an input steps it through 0, 1 and unset.
  stage.addEventListener("click", (event) => {
    const net = (event.target as Element).closest("[data-net]")?.getAttribute("data-net");
    if (simulator === null || !net || !simulator.inputs.includes(net)) return;
    const current = chosen.get(net);
    const next = current === undefined ? 0 : current === 0 ? 1 : null;
    if (next === null) chosen.delete(net);
    else chosen.set(net, next);
    simulator.set(net, next);
    paint();
    onChange();
  });

  return {
    load(circuit, source) {
      if (source !== loaded) {
        simulator = new Simulator(circuit);
        devices = circuit.elements;
        loaded = source;
        for (const net of [...chosen.keys()]) {
          if (!simulator.inputs.includes(net)) chosen.delete(net);
        }
        for (const [net, level] of chosen) simulator.set(net, level);
      }
      paint();
    },
    reset() {
      chosen.clear();
      simulator?.reset();
      paint();
      onChange();
    },
    hasInputs: () => (simulator?.inputs.length ?? 0) > 0,
    describe(net) {
      if (simulator === null) return "";
      const parts: string[] = [];
      const unknown = simulator.lostToSharing(net)
        ? "모름 (떠 있는 노드끼리 다른 값이 이어져 전하가 나뉨)"
        : simulator.isFoughtOver(net)
          ? "모름 (0으로 당기는 경로와 1로 당기는 경로가 함께 켜짐)"
          : "모름";
      if (chosen.size > 0) parts.push(`값 ${simulator.levelOf(net) ?? unknown}`);
      if (simulator.inputs.includes(net)) parts.push("누르면 0 → 1 → 해제");
      return parts.join(" · ");
    },
  };
}

// KaTeX fonts arrive after the first render; label widths measured before that are too narrow.
function onFontsLoaded(callback: () => void): void {
  document.fonts.addEventListener("loadingdone", callback);
}

export type { LabelMeasurer, Logic, Schematic };
export {
  createLogic,
  createMeasurer,
  describeNet,
  drawSchematic,
  highlightNet,
  onFontsLoaded,
  watchNets,
};
