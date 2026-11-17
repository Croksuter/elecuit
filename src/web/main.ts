// role: wires the editor, diagnostics, schematic canvas, zoom and export controls of the page.

import "katex/dist/katex.min.css";
import "./schematic.css";
import "./index.css";

import { toPng, toSvg } from "html-to-image";

import type { NetUse } from "./lib/lint";
import type { Diagnostic } from "./lib/netlist";
import { canvasPrompt, EMBED_SCRIPT_URL, EXAMPLE, PROMPT } from "./lib/prompt";
import {
  createMeasurer,
  createLogic,
  describeNet,
  drawSchematic,
  highlightNet,
  onFontsLoaded,
  watchNets,
  watchZoom,
} from "./schematic";

const STORAGE_KEY = "elecuit.source";
const ZOOM_STEP = 1.25;
const ZOOM_LIMITS = [0.25, 4] as const;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const source = element<HTMLTextAreaElement>("source");
const gutter = element<HTMLDivElement>("gutter");
const status = element<HTMLSpanElement>("status");
const diagnosticsList = element<HTMLUListElement>("diagnostics");
const canvas = element<HTMLDivElement>("canvas");
const stage = element<HTMLDivElement>("stage");
const empty = element<HTMLDivElement>("empty");
const hoverInfo = element<HTMLSpanElement>("hover-info");
const notesView = element<HTMLSpanElement>("notes");
const zoomValue = element<HTMLSpanElement>("zoom-value");
const toast = element<HTMLDivElement>("toast");

const HOVER_HINT = "노드에 마우스를 올리면 연결된 단자가 보입니다.";
const INPUT_HINT =
  "점선으로 두른 입력을 누르면 0 → 1 → 해제 순으로 바뀌고, 회로의 값이 따라 바뀝니다.";
const measurer = createMeasurer();

function loadSource(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveSource(text: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // Storage can be blocked (private mode); the page keeps working without it.
  }
}

let zoom = 1;
let isFitting = true;
let netUses = new Map<string, NetUse[]>();
let hovered: string | null = null;
const resetLogic = element<HTMLButtonElement>("reset-logic");
const logic = createLogic(stage, element<HTMLDivElement>("inputs"), () => showNet(hovered));
const toggleNames = element<HTMLButtonElement>("toggle-names");
let toastTimer = 0;

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1800);
}

function applyZoom(): void {
  const sheet = stage.querySelector<HTMLElement>(".sheet");
  if (!sheet) return;
  if (isFitting) {
    const available = {
      width: canvas.clientWidth - 48,
      height: canvas.clientHeight - 48,
    };
    zoom = Math.min(2, available.width / sheet.offsetWidth, available.height / sheet.offsetHeight);
  }
  stage.style.width = `${sheet.offsetWidth * zoom}px`;
  stage.style.height = `${sheet.offsetHeight * zoom}px`;
  sheet.style.transform = `scale(${zoom})`;
  zoomValue.textContent = `${Math.round(zoom * 100)}%`;
}

function renderGutter(text: string, diagnostics: Diagnostic[]): void {
  const severity = new Map<number, Diagnostic["severity"]>();
  for (const entry of diagnostics) {
    if (severity.get(entry.line) !== "error") severity.set(entry.line, entry.severity);
  }
  const count = text.split("\n").length;
  gutter.innerHTML = Array.from({ length: count }, (_, index) => {
    const line = index + 1;
    const level = severity.get(line);
    return `<div${level ? ` class="${level}"` : ""}>${line}</div>`;
  }).join("");
  gutter.scrollTop = source.scrollTop;
}

function renderDiagnostics(diagnostics: Diagnostic[]): void {
  diagnosticsList.innerHTML = "";
  for (const entry of diagnostics) {
    const item = document.createElement("li");
    item.className = entry.severity;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.line = String(entry.line);
    const line = document.createElement("span");
    line.className = "line";
    line.textContent = `${entry.line}행`;
    const message = document.createElement("span");
    message.textContent = entry.message;
    button.append(line, message);
    item.append(button);
    diagnosticsList.append(item);
  }
  const errors = diagnostics.filter((entry) => entry.severity === "error").length;
  const warnings = diagnostics.length - errors;
  status.className = `status ${errors ? "error" : warnings ? "warning" : "ok"}`;
  status.textContent = errors
    ? `오류 ${errors}${warnings ? ` · 경고 ${warnings}` : ""}`
    : warnings
      ? `경고 ${warnings}`
      : source.value.trim()
        ? "통과"
        : "";
}

function update(): void {
  const text = source.value;
  saveSource(text);
  const schematic = drawSchematic(stage, text, measurer.measure);
  renderGutter(text, schematic.diagnostics);
  renderDiagnostics(schematic.diagnostics);
  netUses = schematic.netUses;
  empty.hidden = schematic.hasElements;
  stage.hidden = !schematic.hasElements;
  notesView.textContent = schematic.notes.join(" ");
  logic.load(schematic.circuit, text);
  resetLogic.hidden = !logic.hasInputs();
  showNet(null);
  applyZoom();
}

function selectLine(line: number): void {
  const lines = source.value.split("\n");
  const start = lines.slice(0, line - 1).reduce((sum, value) => sum + value.length + 1, 0);
  source.focus();
  source.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  const lineHeight = parseFloat(getComputedStyle(source).lineHeight);
  source.scrollTop = Math.max(0, (line - 3) * lineHeight);
}

function showNet(net: string | null): void {
  hovered = net;
  if (net === null) hoverInfo.textContent = logic.hasInputs() ? INPUT_HINT : HOVER_HINT;
  else {
    const about = [describeNet(net, netUses.get(net) ?? []), logic.describe(net)];
    hoverInfo.textContent = about.filter(Boolean).join(" · ");
  }
}

async function copyText(text: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    showToast("클립보드에 쓸 수 없습니다. 브라우저 권한을 확인하세요.");
  }
}

async function exportSheet(kind: "svg" | "png"): Promise<void> {
  const sheet = stage.querySelector<HTMLElement>(".sheet");
  if (!sheet || stage.hidden) {
    showToast("내보낼 회로도가 없습니다.");
    return;
  }
  highlightNet(stage, null);
  const options = {
    backgroundColor: "#ffffff",
    pixelRatio: 3,
    style: { transform: "none" },
    width: sheet.offsetWidth,
    height: sheet.offsetHeight,
  };
  try {
    const url = kind === "svg" ? await toSvg(sheet, options) : await toPng(sheet, options);
    const link = document.createElement("a");
    link.href = url;
    link.download = `elecuit.${kind}`;
    link.click();
  } catch (caught) {
    showToast(
      `내보내기에 실패했습니다: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
  }
}

function loadExample(): void {
  if (source.value.trim() && source.value !== EXAMPLE) {
    if (!window.confirm("지금 입력을 예제로 바꿀까요? 지금 입력은 사라집니다.")) return;
  }
  source.value = EXAMPLE;
  isFitting = true;
  update();
}

source.value = loadSource();
source.addEventListener("input", update);
source.addEventListener("scroll", () => {
  gutter.scrollTop = source.scrollTop;
});
source.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.shiftKey) return;
  event.preventDefault();
  source.setRangeText("  ", source.selectionStart, source.selectionEnd, "end");
  update();
});

diagnosticsList.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-line]");
  if (button) selectLine(Number(button.dataset.line));
});

watchNets(stage, showNet);
// Zooms about the pointer: what is under it stays under it.
watchZoom(canvas, (factor, clientX, clientY) => {
  const next = Math.max(ZOOM_LIMITS[0], Math.min(ZOOM_LIMITS[1], zoom * factor));
  const ratio = next / zoom;
  const box = canvas.getBoundingClientRect();
  const [x, y] = [clientX - box.left, clientY - box.top];
  const [left, top] = [canvas.scrollLeft, canvas.scrollTop];
  isFitting = false;
  zoom = next;
  applyZoom();
  canvas.scrollLeft = (left + x) * ratio - x;
  canvas.scrollTop = (top + y) * ratio - y;
});

element("zoom-in").addEventListener("click", () => {
  isFitting = false;
  zoom = Math.min(ZOOM_LIMITS[1], zoom * ZOOM_STEP);
  applyZoom();
});
element("zoom-out").addEventListener("click", () => {
  isFitting = false;
  zoom = Math.max(ZOOM_LIMITS[0], zoom / ZOOM_STEP);
  applyZoom();
});
element("zoom-fit").addEventListener("click", () => {
  isFitting = true;
  applyZoom();
});
element("save-svg").addEventListener("click", () => void exportSheet("svg"));
resetLogic.addEventListener("click", () => logic.reset());
toggleNames.addEventListener("click", () => {
  toggleNames.textContent = stage.classList.toggle("nameless") ? "이름 보이기" : "이름 숨기기";
});
element("save-png").addEventListener("click", () => void exportSheet("png"));
for (const id of ["copy-prompt", "empty-prompt"]) {
  element(id).addEventListener(
    "click",
    () => void copyText(PROMPT, "프롬프트를 복사했습니다. GPT 대화 첫 메시지로 붙여 넣으세요."),
  );
}
element("copy-canvas-prompt").addEventListener(
  "click",
  () =>
    void copyText(
      canvasPrompt(EMBED_SCRIPT_URL),
      "지침을 복사했습니다. Custom GPT의 지침에 붙여 넣으세요.",
    ),
);
for (const id of ["load-example", "empty-example"])
  element(id).addEventListener("click", loadExample);
new ResizeObserver(() => applyZoom()).observe(canvas);

onFontsLoaded(() => {
  measurer.reset();
  update();
});
update();
