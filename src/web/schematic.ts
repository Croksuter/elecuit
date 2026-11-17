// role: draws a netlist into a stage element in the browser: label measuring, rendering, net hover, logic levels, zoom gestures.

import { netTex } from "./lib/drawing";
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

// `panel` receives one button per input, showing its level and stepping it like a click on the
// sheet does.
function createLogic(stage: HTMLElement, panel: HTMLElement, onChange: () => void): Logic {
  let simulator: Simulator | null = null;
  let devices: Circuit["elements"] = [];
  let labels: Circuit["labels"] = new Map();
  let rails: Circuit["rails"] | null = null;
  let loaded: string | null = null;
  // The levels the viewer chose, in the order chosen; they outlive a redraw.
  const chosen = new Map<string, 0 | 1>();

  // The supply rails show 1 and 0 from the start. Other nets show a known level only in a circuit
  // that has inputs to set; elsewhere (an amplifier, a filter) 0 and 1 would say nothing true.
  function paint(): void {
    if (simulator === null) return;
    const isDigital = simulator.inputs.length > 0;
    for (const node of stage.querySelectorAll("[data-net]")) {
      const net = node.getAttribute("data-net")!;
      const level = isDigital || rails?.has(net) ? simulator.levelOf(net) : null;
      if (level === null) node.removeAttribute("data-level");
      else node.setAttribute("data-level", String(level));
      node.classList.toggle("settable", simulator.inputs.includes(net));
    }
    for (const chip of panel.querySelectorAll("[data-net]")) {
      const level = chosen.get(chip.getAttribute("data-net")!);
      if (level === undefined) chip.removeAttribute("data-level");
      else chip.setAttribute("data-level", String(level));
      chip.querySelector(".chip-level")!.textContent = level === undefined ? "–" : String(level);
    }
    for (const node of stage.querySelectorAll("[data-device]")) {
      const device = devices.find((element) => element.name === node.getAttribute("data-device"));
      const state = isDigital && device?.type === "device" ? simulator.conducts(device) : null;
      if (state === null) node.removeAttribute("data-state");
      else node.setAttribute("data-state", state ? "on" : "off");
    }
  }

  // Steps an input through 0, 1 and unset.
  function step(net: string): void {
    if (simulator === null || !simulator.inputs.includes(net)) return;
    const current = chosen.get(net);
    const next = current === undefined ? 0 : current === 0 ? 1 : null;
    if (next === null) chosen.delete(net);
    else chosen.set(net, next);
    simulator.set(net, next);
    paint();
    onChange();
  }
  stage.addEventListener("click", (event) => {
    const net = (event.target as Element).closest("[data-net]")?.getAttribute("data-net");
    if (net) step(net);
  });
  panel.addEventListener("click", (event) => {
    const net = (event.target as Element).closest("[data-net]")?.getAttribute("data-net");
    if (net) step(net);
  });
  // Pointing at an input's button shows where that input runs on the sheet.
  panel.addEventListener("pointerover", (event) => {
    const net = (event.target as Element).closest("[data-net]")?.getAttribute("data-net");
    highlightNet(stage, net ?? null);
  });
  panel.addEventListener("pointerleave", () => highlightNet(stage, null));

  function fillPanel(): void {
    panel.replaceChildren(
      ...(simulator?.inputs ?? []).map((net) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "input-chip";
        chip.setAttribute("data-net", net);
        chip.title = "누르면 0 → 1 → 해제";
        const name = document.createElement("span");
        name.innerHTML = renderLabelContent(netTex(labels, net), true);
        const level = document.createElement("span");
        level.className = "chip-level";
        chip.append(name, level);
        return chip;
      }),
    );
    panel.hidden = panel.childElementCount === 0;
  }

  return {
    load(circuit, source) {
      if (source !== loaded) {
        simulator = new Simulator(circuit);
        devices = circuit.elements;
        labels = circuit.labels;
        rails = circuit.rails;
        loaded = source;
        for (const net of [...chosen.keys()]) {
          if (!simulator.inputs.includes(net)) chosen.delete(net);
        }
        for (const [net, level] of chosen) simulator.set(net, level);
        fillPanel();
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
      if (simulator.inputs.length > 0 || rails?.has(net)) {
        parts.push(`값 ${simulator.levelOf(net) ?? unknown}`);
      }
      if (simulator.inputs.includes(net)) parts.push("누르면 0 → 1 → 해제");
      return parts.join(" · ");
    },
  };
}

// Reports zoom gestures made over `target` and keeps the browser from zooming the page instead:
// Ctrl or ⌘ with the wheel (a trackpad pinch arrives as this), Safari's pinch gesture, and two
// fingers on a touch screen. `factor` multiplies the current zoom; the point is where to hold still.
function watchZoom(
  target: HTMLElement,
  onZoom: (factor: number, clientX: number, clientY: number) => void,
): void {
  target.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      // A mouse wheel reports far larger steps than a pinch; both end up as gentle steps.
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * 16;
      onZoom(Math.exp(-Math.max(-30, Math.min(30, delta)) * 0.01), event.clientX, event.clientY);
    },
    { passive: false },
  );

  // Safari reports a trackpad pinch as gesture events with the scale since the gesture began.
  let gestureScale = 1;
  target.addEventListener("gesturestart", (event) => {
    event.preventDefault();
    gestureScale = 1;
  });
  target.addEventListener("gesturechange", (event) => {
    event.preventDefault();
    const gesture = event as Event & { scale: number; clientX: number; clientY: number };
    onZoom(gesture.scale / gestureScale, gesture.clientX, gesture.clientY);
    gestureScale = gesture.scale;
  });

  const touches = new Map<number, { x: number; y: number }>();
  function spread(): { distance: number; x: number; y: number } {
    const [first, second] = [...touches.values()];
    return {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
  }
  target.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch")
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  target.addEventListener("pointermove", (event) => {
    if (!touches.has(event.pointerId)) return;
    const before = touches.size === 2 ? spread() : null;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (before === null || before.distance === 0) return;
    const after = spread();
    onZoom(after.distance / before.distance, after.x, after.y);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) {
    target.addEventListener(type, (event) => touches.delete(event.pointerId));
  }
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
  watchZoom,
};
