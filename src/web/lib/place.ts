// role: arranges drawn modules in signal-flow columns, wires pins where the path is clear, names the rest.

import { boundsOf, isBoxFree, isWireClear, labelBox, obstaclesOf, shift } from "./drawing";
import type { Box, Obstacle, Point, Primitive, Sketch } from "./drawing";

// A point of a module where a horizontal wire may arrive from its `side`.
interface Pin {
  net: string;
  x: number;
  y: number;
  side: "left" | "right";
  // Whether the pin has to show its net's name when no wire reaches it.
  needsLabel: boolean;
}

// One self-contained piece of the drawing: a device cluster or a block.
interface Module {
  primitives: Primitive[];
  pins: Pin[];
  drives: string[];
  consumes: string[];
  line: number;
}

interface Placed {
  module: Module;
  width: number;
  height: number;
  leftReach: number;
  rightReach: number;
  column: number;
  x: number;
  y: number;
}

interface PlacedPin extends Pin {
  isWired: boolean;
}

const LABEL_GAP = 4;
const OUTPUT_STUB = 8;
const TRACK_PITCH = 10;
const MODULE_GAP = 22;
const COMPONENT_GAP = 36;
const LABEL_RISE = 10;

// Drops the edges that close a loop, then puts every module as far right as its consumers allow.
function assignColumns(count: number, edges: [number, number][]): number[] {
  const successors = Array.from({ length: count }, (): number[] => []);
  const state = new Array<number>(count).fill(0);
  const finished: number[] = [];
  function visit(index: number): void {
    state[index] = 1;
    for (const [from, to] of edges) {
      if (from !== index || state[to] === 1) continue;
      successors[index].push(to);
      if (state[to] === 0) visit(to);
    }
    state[index] = 2;
    finished.push(index);
  }
  for (let index = 0; index < count; index++) if (state[index] === 0) visit(index);

  const column = new Array<number>(count).fill(0);
  for (const index of [...finished].reverse()) {
    for (const next of successors[index]) column[next] = Math.max(column[next], column[index] + 1);
  }
  for (const index of finished) {
    if (successors[index].length === 0) continue;
    column[index] = Math.min(...successors[index].map((next) => column[next])) - 1;
  }
  return column;
}

function findComponents(count: number, edges: [number, number][]): number[][] {
  const parent = Array.from({ length: count }, (_, index) => index);
  function find(index: number): number {
    while (parent[index] !== index) index = parent[index];
    return index;
  }
  for (const [from, to] of edges) parent[find(from)] = find(to);
  const groups = new Map<number, number[]>();
  for (let index = 0; index < count; index++) {
    groups.set(find(index), [...(groups.get(find(index)) ?? []), index]);
  }
  return [...groups.values()];
}

// Lays out the modules that drive one another and returns their drawing with its top-left at 0,0.
function placeComponent(modules: Module[], columns: number[], sketch: Sketch): Primitive[] {
  const firstColumn = Math.min(...columns);
  const placed = modules.map((module, index): Placed => {
    const box = boundsOf(module.primitives);
    const labelEnd = (pin: Pin): number => LABEL_GAP + sketch.netSize(pin.net).width + 2;
    const labelled = module.pins.filter((pin) => pin.needsLabel);
    return {
      module: {
        ...module,
        primitives: module.primitives.map((primitive) => shift(primitive, -box.x0, -box.y0)),
        pins: module.pins.map((pin) => ({ ...pin, x: pin.x - box.x0, y: pin.y - box.y0 })),
      },
      width: box.x1 - box.x0,
      height: box.y1 - box.y0,
      leftReach: Math.max(
        0,
        ...labelled
          .filter((pin) => pin.side === "left")
          .map((pin) => box.x0 - (pin.x - labelEnd(pin))),
      ),
      rightReach: Math.max(
        0,
        ...labelled
          .filter((pin) => pin.side === "right")
          .map((pin) => pin.x + OUTPUT_STUB + labelEnd(pin) - box.x1),
      ),
      column: columns[index] - firstColumn,
      x: 0,
      y: 0,
    };
  });
  const columnCount = Math.max(...placed.map((entry) => entry.column)) + 1;
  const rows = Array.from({ length: columnCount }, (_, column) =>
    placed
      .filter((entry) => entry.column === column)
      .sort((left, right) => left.module.line - right.module.line),
  );

  // Orders each column by where its neighbours in the next column sit, sweeping both ways.
  function sweep(column: number, neighbour: number): void {
    const others = rows[neighbour];
    const keys = new Map(
      rows[column].map((entry, index) => {
        const mine = neighbour > column ? entry.module.drives : entry.module.consumes;
        const linked = others.flatMap((other, position) => {
          const theirs = neighbour > column ? other.module.consumes : other.module.drives;
          return mine.some((net) => theirs.includes(net)) ? [position] : [];
        });
        const key =
          linked.length === 0
            ? index
            : linked.reduce((sum, value) => sum + value, 0) / linked.length;
        return [entry, key];
      }),
    );
    rows[column].sort((left, right) => keys.get(left)! - keys.get(right)!);
  }
  for (let column = columnCount - 2; column >= 0; column--) sweep(column, column + 1);
  for (let column = 1; column < columnCount; column++) sweep(column, column - 1);
  for (let column = columnCount - 2; column >= 0; column--) sweep(column, column + 1);

  // Vertical positions, right to left: a module lines its output up with the pin it drives.
  for (let column = columnCount - 1; column >= 0; column--) {
    const targets = (rows[column + 1] ?? []).flatMap((entry) =>
      entry.module.pins
        .filter((pin) => pin.side === "left")
        .map((pin) => ({ net: pin.net, y: entry.y + pin.y })),
    );
    let cursor = 0;
    for (const entry of rows[column]) {
      const wanted = entry.module.pins
        .filter((pin) => pin.side === "right")
        .flatMap((pin) =>
          targets.filter((target) => target.net === pin.net).map((target) => target.y - pin.y),
        );
      entry.y = Math.max(cursor, wanted.length === 0 ? cursor : Math.min(...wanted));
      cursor = entry.y + entry.height + MODULE_GAP;
    }
  }

  // A module that drives nothing in the next column is free to drop to the height of the pin
  // that drives it, as far as the module below it allows.
  for (let column = 1; column < columnCount; column++) {
    const sources = rows[column - 1].flatMap((entry) =>
      entry.module.pins
        .filter((pin) => pin.side === "right")
        .map((pin) => ({ net: pin.net, y: entry.y + pin.y })),
    );
    rows[column].forEach((entry, index) => {
      const isFollowed = (rows[column + 1] ?? []).some((next) =>
        entry.module.drives.some((net) => next.module.consumes.includes(net)),
      );
      if (isFollowed) return;
      const below = rows[column][index + 1];
      const lowest = below ? below.y - MODULE_GAP - entry.height : Infinity;
      const wanted = entry.module.pins
        .filter((pin) => pin.side === "left")
        .flatMap((pin) =>
          sources.filter((source) => source.net === pin.net).map((source) => source.y - pin.y),
        )
        .filter((y) => y >= entry.y && y <= lowest);
      if (wanted.length > 0) entry.y = Math.min(...wanted);
    });
  }

  // The nets each channel may wire: the channel before column c joins the right pins of column
  // c - 1 with the left pins of column c.
  function channelPins(column: number): Map<string, { entry: Placed; pin: Pin }[]> {
    const byNet = new Map<string, { entry: Placed; pin: Pin }[]>();
    const sides: [Placed[], Pin["side"]][] = [
      [rows[column - 1] ?? [], "right"],
      [rows[column], "left"],
    ];
    for (const [entries, side] of sides) {
      for (const entry of entries) {
        for (const pin of entry.module.pins) {
          if (pin.side !== side) continue;
          byNet.set(pin.net, [...(byNet.get(pin.net) ?? []), { entry, pin }]);
        }
      }
    }
    for (const [net, list] of byNet) {
      if (list.length < 2 || !list.some(({ pin }) => pin.side === "left")) byNet.delete(net);
    }
    return byNet;
  }

  // Horizontal positions: each channel holds the names of the pins on both sides and one track
  // per net between them.
  const channels = rows.map((_, column) => channelPins(column));
  const trackStart: number[] = [];
  let cursor = 0;
  rows.forEach((entries, column) => {
    const before = Math.max(0, ...(rows[column - 1] ?? []).map((entry) => entry.rightReach));
    const reach = Math.max(0, ...entries.map((entry) => entry.leftReach));
    trackStart.push(cursor + before + TRACK_PITCH);
    cursor += before + (channels[column].size + 1) * TRACK_PITCH + reach;
    for (const entry of entries) entry.x = cursor;
    cursor += Math.max(...entries.map((entry) => entry.width));
  });

  for (const entry of placed) {
    sketch.primitives.push(
      ...entry.module.primitives.map((primitive) => shift(primitive, entry.x, entry.y)),
    );
  }
  const obstacles: Obstacle[] = obstaclesOf(sketch.primitives);
  const pins = new Map<Pin, PlacedPin>();
  for (const entry of placed) {
    for (const pin of entry.module.pins) {
      pins.set(pin, { ...pin, x: entry.x + pin.x, y: entry.y + pin.y, isWired: false });
    }
  }

  function wire(net: string, from: Point, to: Point): void {
    if (from[0] === to[0] && from[1] === to[1]) return;
    sketch.wire(net, from, to);
    obstacles.push(...obstaclesOf([{ type: "wire", net, points: [from, to] }]));
  }

  function nameGroup(net: string, group: PlacedPin[]): void {
    const size = sketch.netSize(net);
    // Beside the driving pin first: several nets often end side by side on one consumer.
    const ordered = [...group].sort(
      (left, right) => Number(left.side === "left") - Number(right.side === "left"),
    );
    const candidates = [LABEL_RISE, -LABEL_RISE].flatMap((rise) =>
      ordered.map((pin) => ({
        x: pin.x + (pin.side === "right" ? 3 : -3),
        y: pin.y - rise,
        anchor: pin.side === "right" ? ("start" as const) : ("end" as const),
      })),
    );
    const boxAt = (candidate: (typeof candidates)[number]): Box =>
      labelBox({ ...candidate, ...size });
    const chosen =
      candidates.find((candidate) => isBoxFree(obstacles, boxAt(candidate))) ?? candidates[0];
    sketch.netLabel([chosen.x, chosen.y], chosen.anchor, net);
    obstacles.push({ box: boxAt(chosen), net, isWire: false });
  }

  const unnamed: { net: string; run: PlacedPin[] }[] = [];
  // Wires one net across a channel: a branch from each pin to a vertical trunk on a free track.
  // Keeps the largest set of pins whose branches and trunk stay clear of every other net.
  channels.forEach((byNet, column) => {
    const nets = [...byNet].map(([net, list]) => ({
      net,
      group: list.map(({ pin }) => pins.get(pin)!).sort((left, right) => left.y - right.y),
    }));
    nets.sort((left, right) => left.group[0].y - right.group[0].y);
    for (const { net, group } of nets) {
      let best: { track: number; run: PlacedPin[] } | null = null;
      for (let index = 0; index < byNet.size; index++) {
        const track = trackStart[column] + index * TRACK_PITCH;
        const reachable = group.filter((pin) =>
          isWireClear(obstacles, net, [pin.x, pin.y], [track, pin.y]),
        );
        let run: PlacedPin[] = [];
        const runs: PlacedPin[][] = [];
        for (const pin of reachable) {
          const previous = run[run.length - 1];
          if (previous && !isWireClear(obstacles, net, [track, previous.y], [track, pin.y])) {
            runs.push(run);
            run = [];
          }
          run.push(pin);
        }
        runs.push(run);
        for (const candidate of runs) {
          if (candidate.length < 2 || !candidate.some((pin) => pin.side === "left")) continue;
          if (best === null || candidate.length > best.run.length) best = { track, run: candidate };
        }
        if (best !== null && best.run.length === group.length) break;
      }
      if (best === null) continue;
      const { track, run } = best;
      const [top, bottom] = [run[0].y, run[run.length - 1].y];
      for (const pin of run) {
        wire(net, [pin.x, pin.y], [track, pin.y]);
        pin.isWired = true;
        const trunkEnds = Number(pin.y > top) + Number(pin.y < bottom);
        const branches = run.filter((other) => other.y === pin.y).length;
        if (trunkEnds + branches >= 3) {
          sketch.dot(net, [track, pin.y]);
          obstacles.push(...obstaclesOf([{ type: "dot", net, x: track, y: pin.y }]));
        }
      }
      wire(net, [track, top], [track, bottom]);
      if (run.every((pin) => pin.needsLabel)) unnamed.push({ net, run });
    }
  });

  // Names that must appear come first; a wired group then takes whatever room is left.
  const firstName = sketch.primitives.length;
  for (const pin of pins.values()) {
    if (pin.isWired || !pin.needsLabel) continue;
    if (pin.side === "left") sketch.netLabel([pin.x - LABEL_GAP, pin.y], "end", pin.net);
    else {
      sketch.wire(pin.net, [pin.x, pin.y], [pin.x + OUTPUT_STUB, pin.y]);
      sketch.netLabel([pin.x + OUTPUT_STUB + LABEL_GAP, pin.y], "start", pin.net);
    }
  }
  obstacles.push(...obstaclesOf(sketch.primitives.slice(firstName)));
  for (const { net, run } of unnamed) nameGroup(net, run);

  const bounds = boundsOf(sketch.primitives);
  return sketch.primitives.map((primitive) => shift(primitive, -bounds.x0, -bounds.y0));
}

// Places all modules: connected ones together in columns, the groups packed into rows.
function place(modules: Module[], createSketch: () => Sketch): Primitive[] {
  const edges: [number, number][] = [];
  modules.forEach((driver, from) => {
    modules.forEach((consumer, to) => {
      if (from === to) return;
      if (driver.drives.some((net) => consumer.consumes.includes(net))) edges.push([from, to]);
    });
  });
  const columns = assignColumns(modules.length, edges);
  const components = findComponents(modules.length, edges)
    .map((indices) => ({
      line: Math.min(...indices.map((index) => modules[index].line)),
      primitives: placeComponent(
        indices.map((index) => modules[index]),
        indices.map((index) => columns[index]),
        createSketch(),
      ),
    }))
    .sort((left, right) => left.line - right.line)
    .map((component) => ({ ...component, box: boundsOf(component.primitives) }));

  // Shelf packing: fill a row up to a width that keeps the sheet about three wide to two high.
  const area = components.reduce(
    (sum, { box }) => sum + (box.x1 + COMPONENT_GAP) * (box.y1 + COMPONENT_GAP),
    0,
  );
  const limit = Math.max(Math.sqrt(area * 1.6), ...components.map(({ box }) => box.x1));
  const result: Primitive[] = [];
  let [x, y, rowHeight] = [0, 0, 0];
  for (const { primitives, box } of components) {
    if (x > 0 && x + box.x1 > limit) {
      [x, y, rowHeight] = [0, y + rowHeight + COMPONENT_GAP, 0];
    }
    result.push(...primitives.map((primitive) => shift(primitive, x, y)));
    x += box.x1 + COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, box.y1);
  }
  return result;
}

export type { Module, Pin };
export { place };
