// role: draws a netlist into a stage element in the browser (label measuring, rendering, net hover).

import { layout } from "./lib/layout";
import type { LabelKind, Measure } from "./lib/layout";
import { collectNetUses, lint } from "./lib/lint";
import type { NetUse } from "./lib/lint";
import { parse } from "./lib/netlist";
import type { Diagnostic } from "./lib/netlist";
import { render, renderLabelContent } from "./lib/render";

interface Schematic {
  diagnostics: Diagnostic[];
  notes: string[];
  hasElements: boolean;
  netUses: Map<string, NetUse[]>;
}

interface LabelMeasurer {
  measure: Measure;
  reset(): void;
}

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
  return { diagnostics, notes, hasElements, netUses: collectNetUses(circuit) };
}

function highlightNet(stage: HTMLElement, net: string | null): void {
  for (const node of stage.querySelectorAll(".on")) node.classList.remove("on");
  stage.classList.toggle("focusing", net !== null);
  if (net === null) return;
  for (const node of stage.querySelectorAll(`[data-net="${CSS.escape(net)}"]`)) {
    node.classList.add("on");
  }
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

// KaTeX fonts arrive after the first render; label widths measured before that are too narrow.
function onFontsLoaded(callback: () => void): void {
  document.fonts.addEventListener("loadingdone", callback);
}

export type { LabelMeasurer, Schematic };
export { createMeasurer, describeNet, drawSchematic, highlightNet, onFontsLoaded, watchNets };
