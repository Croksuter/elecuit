// role: defines drawing primitives, the sketch that collects them, and the geometry tests layouts share.

import type { Caption, Circuit } from "./netlist";

type Point = [number, number];
// "name" is an element's identifier (PCLK, G1); "caption" is text that is part of a symbol (a
// pin's letter, a box's title), which stays when identifiers are hidden.
type LabelKind = "net" | "name" | "caption" | "value";
type TextAnchor = "start" | "middle" | "end";

interface LabelPrimitive {
  type: "label";
  owner: string | null;
  x: number;
  y: number;
  anchor: TextAnchor;
  text: string;
  isTex: boolean;
  kind: LabelKind;
  net: string | null;
  width: number;
  height: number;
}

type Primitive =
  | { type: "wire"; net: string; points: Point[] }
  | { type: "dot"; net: string; x: number; y: number }
  // `owner` names the element a shape, circle or caption belongs to, so the element can light up
  // as a whole. `device` names it again on the one shape that shows the element's state.
  | { type: "shape"; d: string; isHeavy: boolean; device: string | null; owner: string | null }
  | { type: "circle"; x: number; y: number; r: number; owner: string | null }
  | LabelPrimitive;

interface Drawing {
  primitives: Primitive[];
  width: number;
  height: number;
  notes: string[];
}

type Measure = (text: string, isTex: boolean, kind: LabelKind) => { width: number; height: number };

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Something a new wire or label must stay away from. A wire may touch wires of its own net.
interface Obstacle {
  box: Box;
  net: string | null;
  isWire: boolean;
}

const RAIL_TEX: Record<string, string> = {
  VDD: "V_{DD}",
  VCC: "V_{CC}",
  VSS: "V_{SS}",
  VEE: "V_{EE}",
  GND: "\\mathrm{GND}",
};
// Distance a wire keeps from wires of other nets.
const WIRE_CLEARANCE = 5;
const LABEL_CLEARANCE = 1.5;

// How a net's name is written: its `label` formula, a rail's symbol, or the name in italics.
function netTex(labels: Circuit["labels"], net: string): string {
  const label = labels.get(net);
  return label ? label.tex : (RAIL_TEX[net] ?? `\\mathit{${net.replace(/_/g, "\\_")}}`);
}

// Collects primitives in one coordinate frame and measures the labels it adds.
class Sketch {
  readonly primitives: Primitive[] = [];
  private owner: string | null = null;

  constructor(
    private readonly labels: Circuit["labels"],
    private readonly measure: Measure,
  ) {}

  texOf(net: string): string {
    return netTex(this.labels, net);
  }

  // Everything but wires and net names drawn inside `draw` belongs to the element `name`.
  owned<Result>(name: string, draw: () => Result): Result {
    const previous = this.owner;
    this.owner = name;
    try {
      return draw();
    } finally {
      this.owner = previous;
    }
  }

  wire(net: string, ...points: Point[]): void {
    this.primitives.push({ type: "wire", net, points });
  }

  dot(net: string, [x, y]: Point): void {
    this.primitives.push({ type: "dot", net, x, y });
  }

  // A stroke through the points, straight from one to the next.
  stroke(
    points: Point[],
    options: { isHeavy?: boolean; isClosed?: boolean; device?: string } = {},
  ): void {
    const d = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join("");
    this.primitives.push({
      type: "shape",
      d: options.isClosed ? `${d}Z` : d,
      isHeavy: options.isHeavy ?? false,
      device: options.device ?? null,
      owner: this.owner,
    });
  }

  shape(d: string): void {
    this.primitives.push({ type: "shape", d, isHeavy: false, device: null, owner: this.owner });
  }

  circle([x, y]: Point, r: number): void {
    this.primitives.push({ type: "circle", x, y, r, owner: this.owner });
  }

  netLabel([x, y]: Point, anchor: TextAnchor, net: string): void {
    const text = this.texOf(net);
    const size = this.measure(text, true, "net");
    this.primitives.push({
      type: "label",
      x,
      y,
      anchor,
      text,
      isTex: true,
      kind: "net",
      net,
      owner: null,
      ...size,
    });
  }

  nameLabel([x, y]: Point, anchor: TextAnchor, name: string): void {
    this.caption([x, y], anchor, { text: name, isTex: false }, "name");
  }

  caption([x, y]: Point, anchor: TextAnchor, caption: Caption, kind: LabelKind): void {
    const size = this.measure(caption.text, caption.isTex, kind);
    this.primitives.push({
      type: "label",
      x,
      y,
      anchor,
      ...caption,
      kind,
      net: null,
      owner: this.owner,
      ...size,
    });
  }

  netSize(net: string): { width: number; height: number } {
    return this.measure(this.texOf(net), true, "net");
  }

  captionWidth(caption: Caption, kind: LabelKind): number {
    return this.measure(caption.text, caption.isTex, kind).width;
  }
}

function labelBox(label: Pick<LabelPrimitive, "x" | "y" | "anchor" | "width" | "height">): Box {
  const x0 =
    label.anchor === "start"
      ? label.x
      : label.anchor === "middle"
        ? label.x - label.width / 2
        : label.x - label.width;
  return {
    x0,
    y0: label.y - label.height / 2,
    x1: x0 + label.width,
    y1: label.y + label.height / 2,
  };
}

function boxOfPoints(points: Point[]): Box {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function overlaps(left: Box, right: Box, margin: number): boolean {
  return (
    left.x0 - margin < right.x1 &&
    left.x1 + margin > right.x0 &&
    left.y0 - margin < right.y1 &&
    left.y1 + margin > right.y0
  );
}

// Endpoints and control points of a path from this project, enough for a bounding box.
function pathPoints(d: string): Point[] {
  const points: Point[] = [];
  let x = 0;
  let y = 0;
  for (const [, command, body] of d.matchAll(/([MLHVQAZ])([^MLHVQAZ]*)/g)) {
    const numbers =
      body.trim() === ""
        ? []
        : body
            .trim()
            .split(/[\s,]+/)
            .map(Number);
    if (command === "H") x = numbers[0];
    else if (command === "V") y = numbers[0];
    else if (command === "A") [x, y] = [numbers[5], numbers[6]];
    else if (command !== "Z") {
      for (let index = 0; index + 1 < numbers.length; index += 2) {
        points.push([numbers[index], numbers[index + 1]]);
      }
      [x, y] = [numbers[numbers.length - 2], numbers[numbers.length - 1]];
    }
    points.push([x, y]);
  }
  return points;
}

function obstaclesOf(primitives: Primitive[]): Obstacle[] {
  return primitives.flatMap((primitive): Obstacle[] => {
    switch (primitive.type) {
      case "wire":
        return primitive.points.slice(1).map((point, index) => ({
          box: boxOfPoints([primitive.points[index], point]),
          net: primitive.net,
          isWire: true,
        }));
      case "dot":
        return [
          { box: boxOfPoints([[primitive.x, primitive.y]]), net: primitive.net, isWire: true },
        ];
      case "circle":
        return [
          {
            box: {
              x0: primitive.x - primitive.r,
              y0: primitive.y - primitive.r,
              x1: primitive.x + primitive.r,
              y1: primitive.y + primitive.r,
            },
            net: null,
            isWire: false,
          },
        ];
      case "label":
        return [{ box: labelBox(primitive), net: primitive.net, isWire: false }];
      case "shape":
        return [{ box: boxOfPoints(pathPoints(primitive.d)), net: null, isWire: false }];
    }
  });
}

// Whether a wire of `net` along the straight line from `from` to `to` keeps clear of everything
// but wires of its own net.
function isWireClear(obstacles: Obstacle[], net: string, from: Point, to: Point): boolean {
  const box = boxOfPoints([from, to]);
  return !obstacles.some((obstacle) => {
    if (obstacle.isWire && obstacle.net === net) return false;
    return overlaps(box, obstacle.box, obstacle.isWire ? WIRE_CLEARANCE : LABEL_CLEARANCE);
  });
}

function isBoxFree(obstacles: Obstacle[], box: Box): boolean {
  return !obstacles.some((obstacle) => overlaps(box, obstacle.box, LABEL_CLEARANCE));
}

function boundsOf(primitives: Primitive[]): Box {
  const boxes = obstaclesOf(primitives).map((obstacle) => obstacle.box);
  if (boxes.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

// Shifts absolute path commands (M, L, H, V, Q, A, Z) produced by this project.
function shiftPath(d: string, dx: number, dy: number): string {
  return d.replace(/([MLHVQAZ])([^MLHVQAZ]*)/g, (_match, command: string, body: string) => {
    const numbers =
      body.trim() === ""
        ? []
        : body
            .trim()
            .split(/[\s,]+/)
            .map(Number);
    let moved: number[];
    if (command === "H") moved = numbers.map((value) => value + dx);
    else if (command === "V") moved = numbers.map((value) => value + dy);
    else if (command === "A") {
      moved = numbers.map((value, index) =>
        index === 5 ? value + dx : index === 6 ? value + dy : value,
      );
    } else moved = numbers.map((value, index) => value + (index % 2 === 0 ? dx : dy));
    return command + moved.join(" ");
  });
}

function shift(primitive: Primitive, dx: number, dy: number): Primitive {
  switch (primitive.type) {
    case "wire":
      return { ...primitive, points: primitive.points.map(([x, y]) => [x + dx, y + dy] as Point) };
    case "shape":
      return { ...primitive, d: shiftPath(primitive.d, dx, dy) };
    default:
      return { ...primitive, x: primitive.x + dx, y: primitive.y + dy };
  }
}

export type { Box, Drawing, LabelKind, Measure, Obstacle, Point, Primitive };
export { boundsOf, isBoxFree, isWireClear, labelBox, netTex, obstaclesOf, overlaps, shift, Sketch };
