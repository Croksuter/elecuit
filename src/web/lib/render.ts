// role: renders drawing primitives as an SVG sheet with KaTeX label overlays, and a title as markup.

import katex from "katex";

import type { Drawing, Primitive } from "./drawing";

const TRANSLATE = {
  start: "translate(0,-50%)",
  middle: "translate(-50%,-50%)",
  end: "translate(-100%,-50%)",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function renderLabelContent(text: string, isTex: boolean): string {
  return isTex ? katex.renderToString(text, { throwOnError: false }) : escapeHtml(text);
}

// A title mixes plain words with $…$ spans; a `$` without a partner stays a plain character.
function renderTitle(text: string): string {
  return text
    .split(/\$([^$]+)\$/)
    .map((part, index) => renderLabelContent(part, index % 2 === 1))
    .join("");
}

function renderPrimitive(primitive: Primitive): string {
  switch (primitive.type) {
    case "wire": {
      const points = primitive.points.map(([x, y]) => `${x},${y}`).join(" ");
      const net = escapeHtml(primitive.net);
      return (
        `<polyline class="wire" data-net="${net}" points="${points}"/>` +
        `<polyline class="hit" data-net="${net}" points="${points}"/>`
      );
    }
    case "dot":
      return `<circle class="dot" data-net="${escapeHtml(primitive.net)}" cx="${primitive.x}" cy="${primitive.y}" r="3"/>`;
    case "shape":
      return `<path class="${primitive.isHeavy ? "body heavy" : "body"}" d="${primitive.d}"/>`;
    case "circle":
      return `<circle class="bubble" cx="${primitive.x}" cy="${primitive.y}" r="${primitive.r}"/>`;
    case "label":
      return "";
  }
}

function renderLabel(primitive: Extract<Primitive, { type: "label" }>): string {
  const net = primitive.net === null ? "" : ` data-net="${escapeHtml(primitive.net)}"`;
  const style = `left:${primitive.x}px;top:${primitive.y}px;transform:${TRANSLATE[primitive.anchor]}`;
  return `<div class="label label-${primitive.kind}"${net} style="${style}">${renderLabelContent(primitive.text, primitive.isTex)}</div>`;
}

function render(drawing: Drawing): string {
  const shapes = drawing.primitives.map(renderPrimitive).join("");
  const labels = drawing.primitives
    .filter(
      (primitive): primitive is Extract<Primitive, { type: "label" }> => primitive.type === "label",
    )
    .map(renderLabel)
    .join("");
  const { width, height } = drawing;
  return (
    `<div class="sheet" style="width:${width}px;height:${height}px">` +
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>` +
    `${labels}</div>`
  );
}

export { render, renderLabelContent, renderTitle };
