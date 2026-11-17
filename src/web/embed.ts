// role: renders every <script type="text/elecuit"> block of a host page as an inline schematic figure.

import katex from "katex";

import embedStyles from "./embed.css?inline";
import { arrange } from "./lib/arrange";
import { renderTitle } from "./lib/render";
import schematicStyles from "./schematic.css?inline";
import {
  createLogic,
  createMeasurer,
  drawSchematic,
  onFontsLoaded,
  watchNets,
  watchZoom,
} from "./schematic";
import type { LabelMeasurer } from "./schematic";

interface Figure {
  element: HTMLElement;
  viewport: HTMLElement;
  // The title and the inputs, floating over the top left of the frame.
  head: HTMLElement;
  stage: HTMLElement;
  // What the viewer zoomed to, on top of the scale the group fits at.
  zoom: number;
  redraw(): void;
}

const BLOCK_SELECTOR = 'script[type="text/elecuit"]';
const KATEX_STYLES = `https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css`;
const GROUP_GAP = 20;
// Room the frame keeps around the schematic so the controls floating over it cover nothing at
// the fitted size: its border and left margin, and on the right the column of buttons.
const FRAME_BORDER = 2;
const LEFT_ROOM = 16;
const RIGHT_ROOM = 60;
const BOTTOM_ROOM = 16;
const SIDE_ROOM = FRAME_BORDER + LEFT_ROOM + RIGHT_ROOM;
// A figure narrower than this cannot hold its inputs and its diagnostics.
const MIN_FIGURE_WIDTH = 240;
const ZOOM_STEP = 1.25;
const ZOOM_LIMITS = [0.3, 6] as const;
const ICONS = {
  zoomIn: '<path d="M12 5v14M5 12h14"/>',
  zoomOut: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  names:
    '<path d="M12 3H4v8l9.5 9.5a1.5 1.5 0 0 0 2.1 0l5.9-5.9a1.5 1.5 0 0 0 0-2.1z"/><circle cx="8" cy="7.5" r="1.4"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v5h5"/>',
};

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

// A figure is a frame the schematic scrolls in, with its controls floating in the corners the way
// a map's do: title and inputs top left, name toggle and reset top right, zoom bottom right.
// Only the diagnostics sit outside, below the frame.
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
  const frame = document.createElement("div");
  frame.className = "elecuit-frame";
  const viewport = document.createElement("div");
  viewport.className = "elecuit-viewport";
  viewport.style.padding = `0 ${RIGHT_ROOM}px ${BOTTOM_ROOM}px ${LEFT_ROOM}px`;
  const stage = document.createElement("div");
  stage.className = "stage";
  const head = document.createElement("div");
  head.className = "elecuit-head";
  const inputs = document.createElement("div");
  inputs.className = "input-panel elecuit-inputs";
  inputs.hidden = true;
  const title = block.getAttribute("title");
  if (title) {
    const caption = document.createElement("figcaption");
    caption.className = "elecuit-title";
    caption.innerHTML = renderTitle(title);
    head.append(caption);
  }
  head.append(inputs);
  const upperTools = document.createElement("div");
  upperTools.className = "elecuit-tools elecuit-tools-upper";
  const lowerTools = document.createElement("div");
  lowerTools.className = "elecuit-tools elecuit-tools-lower";
  const diagnosticsList = document.createElement("ul");
  diagnosticsList.className = "elecuit-diagnostics";
  viewport.append(stage);
  frame.append(viewport, head, upperTools, lowerTools);
  element.append(frame, diagnosticsList);

  function addTool(
    group: HTMLElement,
    label: string,
    icon: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
    button.addEventListener("click", onClick);
    group.append(button);
    return button;
  }

  const logic = createLogic(stage, inputs, () => {});

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

  const names = addTool(upperTools, "소자 이름 숨기기", ICONS.names, () => {
    const isHidden = stage.classList.toggle("nameless");
    const label = isHidden ? "소자 이름 보이기" : "소자 이름 숨기기";
    names.title = label;
    names.setAttribute("aria-label", label);
    names.setAttribute("aria-pressed", String(isHidden));
  });
  const reset = addTool(upperTools, "누른 입력과 기억된 상태 지우기", ICONS.reset, () =>
    logic.reset(),
  );
  reset.hidden = true;
  addTool(lowerTools, "확대 (Ctrl·⌘+휠, 두 손가락으로도)", ICONS.zoomIn, () =>
    zoomAtCentre(ZOOM_STEP),
  );
  addTool(lowerTools, "축소", ICONS.zoomOut, () => zoomAtCentre(1 / ZOOM_STEP));
  addTool(lowerTools, "처음 크기로 맞춤", ICONS.fit, () => {
    figure.zoom = 1;
    refit();
  });

  function redraw(): void {
    const schematic = drawSchematic(stage, text, measurer.measure);
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
  }

  watchNets(stage, () => {});
  const figure: Figure = { element, viewport, head, stage, zoom: 1, redraw };
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
    // Counting each frame's side room as part of the gap leaves `arrange` with sheet widths only.
    const { scale, columnWidths } = arrange(
      sheets.map((sheet) => Math.max(sheet?.offsetWidth ?? 0, MIN_FIGURE_WIDTH)),
      group.clientWidth - SIDE_ROOM,
      GROUP_GAP + SIDE_ROOM,
    );
    group.style.gridTemplateColumns =
      columnWidths.length === 1
        ? "minmax(0, 1fr)"
        : columnWidths.map((width) => `${width + SIDE_ROOM}px`).join(" ");
    figures.forEach(({ stage, viewport, head, zoom }, index) => {
      const sheet = sheets[index];
      stage.style.width = sheet ? `${sheet.offsetWidth * scale * zoom}px` : "";
      stage.style.height = sheet ? `${sheet.offsetHeight * scale * zoom}px` : "";
      if (sheet) sheet.style.transform = `scale(${scale * zoom})`;
      // The schematic starts below the title and inputs, however many lines they take.
      const top = head.offsetHeight + 24;
      viewport.style.paddingTop = `${top}px`;
      // Zoomed in, the frame keeps the height it fits at and the schematic scrolls inside it.
      viewport.style.maxHeight =
        sheet && zoom > 1 ? `${sheet.offsetHeight * scale + top + BOTTOM_ROOM}px` : "";
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
