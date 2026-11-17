// role: renders every <script type="text/elecuit"> block of a host page as an inline schematic figure.

import katex from "katex";

import embedStyles from "./embed.css?inline";
import type { NetUse } from "./lib/lint";
import schematicStyles from "./schematic.css?inline";
import { createMeasurer, describeNet, drawSchematic, onFontsLoaded, watchNets } from "./schematic";
import type { LabelMeasurer } from "./schematic";

const BLOCK_SELECTOR = 'script[type="text/elecuit"]';
const KATEX_STYLES = `https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css`;
const MAX_SCALE = 1.25;
const HOVER_HINT = "노드에 마우스를 올리면 연결된 단자가 보입니다.";

// Inserts a figure after the block and returns the function that redraws it.
function createFigure(
  block: HTMLScriptElement,
  measurer: LabelMeasurer,
  problems: string[],
): () => void {
  // The line break right after the opening tag is not a netlist line; dropping it keeps
  // reported line numbers aligned with what the author wrote.
  const text = (block.textContent ?? "").replace(/^\r?\n/, "");
  const figure = document.createElement("figure");
  figure.className = "elecuit";
  const viewport = document.createElement("div");
  viewport.className = "elecuit-viewport";
  const stage = document.createElement("div");
  stage.className = "stage";
  const diagnosticsList = document.createElement("ul");
  diagnosticsList.className = "elecuit-diagnostics";
  const info = document.createElement("figcaption");
  info.className = "elecuit-info";
  viewport.append(stage);
  figure.append(viewport, diagnosticsList, info);
  block.after(figure);

  let netUses = new Map<string, NetUse[]>();

  function fit(): void {
    const sheet = stage.querySelector<HTMLElement>(".sheet");
    if (!sheet) {
      stage.style.width = "";
      stage.style.height = "";
      return;
    }
    const scale = Math.min(MAX_SCALE, viewport.clientWidth / sheet.offsetWidth);
    stage.style.width = `${sheet.offsetWidth * scale}px`;
    stage.style.height = `${sheet.offsetHeight * scale}px`;
    sheet.style.transform = `scale(${scale})`;
  }

  function redraw(): void {
    const schematic = drawSchematic(stage, text, measurer.measure);
    netUses = schematic.netUses;
    const lines = [
      ...problems.map((message) => ({ severity: "error", text: message })),
      ...schematic.diagnostics.map((entry) => ({
        severity: entry.severity,
        text: `${entry.line}행 ${entry.message}`,
      })),
      ...schematic.notes.map((message) => ({ severity: "warning", text: message })),
    ];
    if (!schematic.hasElements && lines.length === 0) {
      lines.push({ severity: "warning", text: "netlist에 소자가 없습니다." });
    }
    diagnosticsList.replaceChildren(
      ...lines.map((line) => {
        const item = document.createElement("li");
        item.className = line.severity;
        item.textContent = line.text;
        return item;
      }),
    );
    info.textContent = schematic.hasElements ? HOVER_HINT : "";
    fit();
  }

  watchNets(stage, (net) => {
    info.textContent = net === null ? HOVER_HINT : describeNet(net, netUses.get(net) ?? []);
  });
  new ResizeObserver(fit).observe(viewport);
  return redraw;
}

function start(): void {
  const blocks = [...document.querySelectorAll<HTMLScriptElement>(BLOCK_SELECTOR)];
  if (blocks.length === 0) return;

  const style = document.createElement("style");
  style.textContent = schematicStyles + embedStyles;
  document.head.append(style);

  const measurer = createMeasurer();
  const problems: string[] = [];
  const redraws = blocks.map((block) => createFigure(block, measurer, problems));
  function redrawAll(): void {
    measurer.reset();
    redraws.forEach((redraw) => redraw());
  }

  // Labels need the KaTeX stylesheet before they can be measured, so drawing waits for it.
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = KATEX_STYLES;
  link.addEventListener("load", redrawAll);
  link.addEventListener("error", () => {
    problems.push(`KaTeX 스타일을 불러오지 못해 수식이 깨져 보일 수 있습니다 (${KATEX_STYLES}).`);
    redrawAll();
  });
  document.head.append(link);
  onFontsLoaded(redrawAll);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
