// role: renders every <script type="text/elecuit"> block of a host page as an inline schematic figure.

import katex from "katex";

import embedStyles from "./embed.css?inline";
import { arrange } from "./lib/arrange";
import type { NetUse } from "./lib/lint";
import { renderTitle } from "./lib/render";
import schematicStyles from "./schematic.css?inline";
import {
  createLogic,
  createMeasurer,
  describeNet,
  drawSchematic,
  onFontsLoaded,
  watchNets,
  watchZoom,
} from "./schematic";
import type { LabelMeasurer } from "./schematic";

interface Figure {
  element: HTMLElement;
  viewport: HTMLElement;
  stage: HTMLElement;
  // What the viewer zoomed to, on top of the scale the group fits at.
  zoom: number;
  redraw(): void;
}

const BLOCK_SELECTOR = 'script[type="text/elecuit"]';
const KATEX_STYLES = `https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css`;
const HOVER_HINT = "노드에 마우스를 올리면 연결된 단자가 보입니다.";
const INPUT_HINT =
  "점선으로 두른 입력을 누르면 0 → 1 → 해제 순으로 바뀌고, 회로의 값이 따라 바뀝니다.";
const GROUP_GAP = 20;
// Left and right padding of `.elecuit-viewport` together; each figure is this much wider than
// its scaled sheet.
const VIEWPORT_PADDING = 8;
// A figure narrower than this cannot hold its diagnostics and net description.
const MIN_FIGURE_WIDTH = 240;
const ZOOM_STEP = 1.25;
const ZOOM_LIMITS = [0.3, 6] as const;

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
  refit: () => void,
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
  const tools = document.createElement("div");
  tools.className = "elecuit-tools";
  function addTool(text: string, hint: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = hint;
    button.addEventListener("click", onClick);
    tools.append(button);
    return button;
  }
  viewport.append(stage);
  element.append(viewport, diagnosticsList, info, tools);
  const title = block.getAttribute("title");
  if (title) {
    const caption = document.createElement("figcaption");
    caption.className = "elecuit-title";
    caption.innerHTML = renderTitle(title);
    element.prepend(caption);
  }

  let netUses = new Map<string, NetUse[]>();
  let hovered: string | null = null;

  function showInfo(): void {
    if (stage.childElementCount === 0) info.textContent = "";
    else if (hovered === null) info.textContent = logic.hasInputs() ? INPUT_HINT : HOVER_HINT;
    else {
      const about = [describeNet(hovered, netUses.get(hovered) ?? []), logic.describe(hovered)];
      info.textContent = about.filter(Boolean).join(" · ");
    }
  }
  const logic = createLogic(stage, showInfo);

  // Zooms about a point of the viewport, so what is under the pointer stays under it.
  function zoomBy(factor: number, clientX: number, clientY: number): void {
    const next = Math.max(ZOOM_LIMITS[0], Math.min(ZOOM_LIMITS[1], figure.zoom * factor));
    const ratio = next / figure.zoom;
    const box = viewport.getBoundingClientRect();
    const [x, y] = [clientX - box.left, clientY - box.top];
    const [left, top] = [viewport.scrollLeft, viewport.scrollTop];
    figure.zoom = next;
    refit();
    viewport.scrollLeft = (left + x) * ratio - x;
    viewport.scrollTop = (top + y) * ratio - y;
  }
  function zoomAtCentre(factor: number): void {
    const box = viewport.getBoundingClientRect();
    zoomBy(factor, box.left + box.width / 2, box.top + box.height / 2);
  }
  watchZoom(viewport, zoomBy);
  const zoomHint = "Ctrl(⌘)+휠이나 두 손가락으로도 확대·축소합니다.";
  addTool("−", zoomHint, () => zoomAtCentre(1 / ZOOM_STEP));
  addTool("+", zoomHint, () => zoomAtCentre(ZOOM_STEP));
  addTool("맞춤", "처음 크기로 되돌립니다.", () => {
    figure.zoom = 1;
    refit();
  });
  const reset = addTool("값 지우기", "누른 입력과 기억된 상태를 지웁니다.", () => logic.reset());
  reset.hidden = true;

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
    logic.load(schematic.circuit, text);
    reset.hidden = !logic.hasInputs();
    showInfo();
  }

  watchNets(stage, (net) => {
    hovered = net;
    showInfo();
  });
  const figure: Figure = { element, viewport, stage, zoom: 1, redraw };
  return figure;
}

// Inserts the figures of one group after its last block and returns the function that redraws
// them. The figures share one scale and sit side by side while the row is wide enough.
function createGroup(
  blocks: HTMLScriptElement[],
  measurer: LabelMeasurer,
  problems: string[],
): () => void {
  const figures = blocks.map((block) => createFigure(block, measurer, problems, () => fit()));
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
    figures.forEach(({ stage, viewport, zoom }, index) => {
      const sheet = sheets[index];
      stage.style.width = sheet ? `${sheet.offsetWidth * scale * zoom}px` : "";
      stage.style.height = sheet ? `${sheet.offsetHeight * scale * zoom}px` : "";
      if (sheet) sheet.style.transform = `scale(${scale * zoom})`;
      // Zoomed in, the figure keeps the height it fits at and the schematic scrolls inside it.
      viewport.style.maxHeight =
        sheet && zoom > 1 ? `${sheet.offsetHeight * scale + VIEWPORT_PADDING}px` : "";
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
