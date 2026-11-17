// role: renders every <script type="text/elecuit"> block of a host page as an inline schematic figure.

import katex from "katex";

import embedStyles from "./embed.css?inline";
import { arrange } from "./lib/arrange";
import type { NetUse } from "./lib/lint";
import { renderTitle } from "./lib/render";
import schematicStyles from "./schematic.css?inline";
import { createMeasurer, describeNet, drawSchematic, onFontsLoaded, watchNets } from "./schematic";
import type { LabelMeasurer } from "./schematic";

interface Figure {
  element: HTMLElement;
  stage: HTMLElement;
  redraw(): void;
}

const BLOCK_SELECTOR = 'script[type="text/elecuit"]';
const KATEX_STYLES = `https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css`;
const HOVER_HINT = "노드에 마우스를 올리면 연결된 단자가 보입니다.";
const GROUP_GAP = 20;
// Left and right padding of `.elecuit-viewport` together; each figure is this much wider than
// its scaled sheet.
const VIEWPORT_PADDING = 8;
// A figure narrower than this cannot hold its diagnostics and net description.
const MIN_FIGURE_WIDTH = 240;

// Blocks written one after another, with only white space or comments between them, form a group.
function groupBlocks(blocks: HTMLScriptElement[]): HTMLScriptElement[][] {
  function isNextTo(previous: HTMLScriptElement, block: HTMLScriptElement): boolean {
    let node = previous.nextSibling;
    while (node && node !== block) {
      const isSpace = node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === "";
      if (!isSpace && node.nodeType !== Node.COMMENT_NODE) return false;
      node = node.nextSibling;
    }
    return node === block;
  }

  const groups: HTMLScriptElement[][] = [];
  for (const block of blocks) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group && previous && isNextTo(previous, block)) group.push(block);
    else groups.push([block]);
  }
  return groups;
}

function createFigure(
  block: HTMLScriptElement,
  measurer: LabelMeasurer,
  problems: string[],
): Figure {
  // The line break right after the opening tag is not a netlist line; dropping it keeps
  // reported line numbers aligned with what the author wrote.
  const text = (block.textContent ?? "").replace(/^\r?\n/, "");
  const element = document.createElement("figure");
  element.className = "elecuit";
  const viewport = document.createElement("div");
  viewport.className = "elecuit-viewport";
  const stage = document.createElement("div");
  stage.className = "stage";
  const diagnosticsList = document.createElement("ul");
  diagnosticsList.className = "elecuit-diagnostics";
  const info = document.createElement("div");
  info.className = "elecuit-info";
  viewport.append(stage);
  element.append(viewport, diagnosticsList, info);
  const title = block.getAttribute("title");
  if (title) {
    const caption = document.createElement("figcaption");
    caption.className = "elecuit-title";
    caption.innerHTML = renderTitle(title);
    element.prepend(caption);
  }

  let netUses = new Map<string, NetUse[]>();

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
  }

  watchNets(stage, (net) => {
    info.textContent = net === null ? HOVER_HINT : describeNet(net, netUses.get(net) ?? []);
  });
  return { element, stage, redraw };
}

// Inserts the figures of one group after its last block and returns the function that redraws
// them. The figures share one scale and sit side by side while the row is wide enough.
function createGroup(
  blocks: HTMLScriptElement[],
  measurer: LabelMeasurer,
  problems: string[],
): () => void {
  const figures = blocks.map((block) => createFigure(block, measurer, problems));
  const group = document.createElement("div");
  group.className = "elecuit-group";
  group.style.gap = `${GROUP_GAP}px`;
  group.append(...figures.map((figure) => figure.element));
  blocks[blocks.length - 1].after(group);

  function fit(): void {
    const sheets = figures.map((figure) => figure.stage.querySelector<HTMLElement>(".sheet"));
    // Counting the padding as part of the gap leaves `arrange` with sheet widths only.
    const { scale, columnWidths } = arrange(
      sheets.map((sheet) => Math.max(sheet?.offsetWidth ?? 0, MIN_FIGURE_WIDTH)),
      group.clientWidth - VIEWPORT_PADDING,
      GROUP_GAP + VIEWPORT_PADDING,
    );
    group.style.gridTemplateColumns =
      columnWidths.length === 1
        ? "minmax(0, 1fr)"
        : columnWidths.map((width) => `${width + VIEWPORT_PADDING}px`).join(" ");
    figures.forEach(({ stage }, index) => {
      const sheet = sheets[index];
      stage.style.width = sheet ? `${sheet.offsetWidth * scale}px` : "";
      stage.style.height = sheet ? `${sheet.offsetHeight * scale}px` : "";
      if (sheet) sheet.style.transform = `scale(${scale})`;
    });
  }

  new ResizeObserver(fit).observe(group);
  return () => {
    figures.forEach((figure) => figure.redraw());
    fit();
  };
}

function start(): void {
  const blocks = [...document.querySelectorAll<HTMLScriptElement>(BLOCK_SELECTOR)];
  if (blocks.length === 0) return;

  const style = document.createElement("style");
  style.textContent = schematicStyles + embedStyles;
  document.head.append(style);

  const measurer = createMeasurer();
  const problems: string[] = [];
  // Grouping reads the blocks' neighbours, so it finishes before any figure enters the page.
  const redraws = groupBlocks(blocks).map((group) => createGroup(group, measurer, problems));
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
