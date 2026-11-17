// role: lays out one cluster of connected devices: nodes as buses on levels, devices between them.

import { isBoxFree, labelBox, obstaclesOf } from "./drawing";
import type { Point, Sketch } from "./drawing";
import { isBottomRail, isRail, isTopRail } from "./netlist";
import type { Device, Terminal } from "./netlist";
import type { Pin } from "./place";
import {
  BODY_HALF,
  CAP_ZONE,
  DEVICE_LENGTH,
  drawCap,
  drawDevice,
  flat as flatFrame,
  upright as uprightFrame,
} from "./symbols";

// A device standing between two lines; a cap replaces the line where its pin is a rail.
interface Upright {
  device: Device;
  upper: Terminal;
  lower: Terminal;
  topLine: number;
  bottomLine: number;
  hasTopCap: boolean;
  hasBottomCap: boolean;
}

// What takes one place in the left-to-right order: a column of stacked devices, one or two
// devices lying on a line between two nodes, or a device that joins nothing and shows names only.
type Item =
  | { type: "chain"; devices: Upright[] }
  | { type: "flat"; level: number; nets: [string, string]; devices: Device[] }
  | { type: "loose"; device: Device };

interface Attachment {
  item: number;
  coordinate: number;
}

// The part of a node drawn as one bus; a node splits where a single bus would cross another net.
interface Fragment {
  net: string;
  level: number;
  attachments: Attachment[];
}

const LABEL_GAP = 4;
const NAME_GAP = 8;
const UPRIGHT_REACH = 48;
const FLAT_REACH = 32;
const FLAT_LEAD = 10;
const ITEM_GAP = 12;
const PAIR_OFFSET = 24;
const LABEL_HEIGHT = 16;
// A capacitor passes no steady current, so it barely pulls its nodes together.
const CAP_CONDUCTANCE = 1e-5;
// Nodes closer than this in potential share a level, and a device between them lies flat.
const LEVEL_TOLERANCE = 2e-4;
const WEAK_MARK = { text: "(weak)", isTex: false };
const CROSSING_COST = 1000;
// What one place further right costs a chain whose control comes from outside the cluster; more
// than a unit of bus length, so such a chain ends up where a wire from the left can reach it.
const CONTROL_PULL = 1.5;

// Without a supply rail the top of the drawing is the node a voltage source lifts above the
// bottom rail, or else the node farthest from the bottom rail.
function findStandInTops(devices: Device[], nodes: string[]): string[] {
  const lifted = devices
    .filter(
      (device) =>
        device.kind === "vsrc" && !isRail(device.pins[0].net) && isBottomRail(device.pins[1].net),
    )
    .map((device) => device.pins[0].net);
  if (lifted.length > 0) return [...new Set(lifted)];

  const distance = new Map<string, number>();
  let frontier = devices.flatMap((device) => {
    const [first, second] = device.pins.map((pin) => pin.net);
    if (isBottomRail(first) && !isRail(second)) return [second];
    if (isBottomRail(second) && !isRail(first)) return [first];
    return [];
  });
  for (let step = 1; frontier.length > 0; step++) {
    const next: string[] = [];
    for (const net of frontier) {
      if (distance.has(net)) continue;
      distance.set(net, step);
      for (const device of devices) {
        const nets = device.pins.map((pin) => pin.net);
        if (!nets.includes(net)) continue;
        next.push(...nets.filter((other) => !isRail(other) && !distance.has(other)));
      }
    }
    frontier = next;
  }
  const farthest = Math.max(...nodes.map((net) => distance.get(net) ?? 0));
  const isOnSource = (net: string): boolean =>
    devices.some(
      (device) =>
        (device.kind === "vsrc" || device.kind === "isrc") &&
        device.pins.some((pin) => pin.net === net),
    );
  const degree = (net: string): number =>
    devices.filter((device) => device.pins.some((pin) => pin.net === net)).length;
  const [top] = nodes
    .filter((net) => (distance.get(net) ?? 0) === farthest)
    .sort(
      (left, right) =>
        Number(isOnSource(left)) - Number(isOnSource(right)) || degree(right) - degree(left),
    );
  return [top];
}

// Treats every device as a unit conductance between top rails at 1 and bottom rails at 0 and
// solves the node potentials; their order is the top-to-bottom order of the drawing.
function solvePotentials(devices: Device[], nodes: string[]): Map<string, number> {
  const potentials = new Map(nodes.map((net) => [net, 0]));
  const nets = devices.flatMap((device) => device.pins.map((pin) => pin.net));
  const hasTop = nets.some(isTopRail);
  if (nodes.length === 0 || (!hasTop && !nets.some(isBottomRail))) return potentials;

  const fixed = new Map<string, number>();
  for (const net of nets) if (isRail(net)) fixed.set(net, isTopRail(net) ? 1 : 0);
  if (!hasTop) for (const net of findStandInTops(devices, nodes)) fixed.set(net, 1);

  const unknowns = nodes.filter((net) => !fixed.has(net));
  const rowOf = new Map(unknowns.map((net, row) => [net, row]));
  const size = unknowns.length;
  const matrix = unknowns.map(() => new Array<number>(size + 1).fill(0));
  for (const device of devices) {
    const [first, second] = device.pins.map((pin) => pin.net);
    if (first === second) continue;
    const conductance = device.kind === "cap" ? CAP_CONDUCTANCE : 1;
    for (const [here, there] of [
      [first, second],
      [second, first],
    ]) {
      const row = rowOf.get(here);
      if (row === undefined) continue;
      matrix[row][row] += conductance;
      const column = rowOf.get(there);
      if (column === undefined) matrix[row][size] += conductance * fixed.get(there)!;
      else matrix[row][column] -= conductance;
    }
  }
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    if (Math.abs(matrix[column][column]) < 1e-12) continue;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = matrix[row][column] / matrix[column][column];
      for (let entry = column; entry <= size; entry++) {
        matrix[row][entry] -= factor * matrix[column][entry];
      }
    }
  }
  for (const [net, value] of fixed) if (potentials.has(net)) potentials.set(net, value);
  unknowns.forEach((net, row) => {
    const diagonal = matrix[row][row];
    potentials.set(net, Math.abs(diagonal) < 1e-12 ? 0 : matrix[row][size] / diagonal);
  });
  return potentials;
}

// Gives each node a line number, 1 at the top. Nodes joined by a device at the same potential
// share a line; every other device runs from a higher line to a lower one.
function assignLevels(devices: Device[], nodes: string[]): Map<string, number> {
  const potentials = solvePotentials(devices, nodes);
  const parent = new Map(nodes.map((net) => [net, net]));
  function find(net: string): string {
    while (parent.get(net) !== net) net = parent.get(net)!;
    return net;
  }
  const edges = devices
    .map((device) => device.pins.map((pin) => pin.net))
    .filter(([first, second]) => first !== second && !isRail(first) && !isRail(second));
  for (const [first, second] of edges) {
    if (Math.abs(potentials.get(first)! - potentials.get(second)!) < LEVEL_TOLERANCE) {
      parent.set(find(first), find(second));
    }
  }
  const members = new Map<string, string[]>();
  for (const net of nodes) members.set(find(net), [...(members.get(find(net)) ?? []), net]);
  const mean = (root: string): number => {
    const group = members.get(root)!;
    return group.reduce((sum, net) => sum + potentials.get(net)!, 0) / group.length;
  };
  const roots = [...members.keys()].sort((left, right) => mean(right) - mean(left));
  const levelOfRoot = new Map<string, number>();
  for (const root of roots) {
    let level = 1;
    for (const [first, second] of edges) {
      const [here, there] = [find(first), find(second)];
      const other = here === root ? there : there === root ? here : null;
      if (other === null || other === root || !levelOfRoot.has(other)) continue;
      level = Math.max(level, levelOfRoot.get(other)! + 1);
    }
    levelOfRoot.set(root, level);
  }
  return new Map(nodes.map((net) => [net, levelOfRoot.get(find(net))!]));
}

function buildItems(devices: Device[], levels: Map<string, number>): Item[] {
  const uprights: Upright[] = [];
  const flats = new Map<string, { level: number; nets: [string, string]; devices: Device[] }>();
  const loose: Device[] = [];

  for (const device of devices) {
    const [first, second] = device.pins;
    const isSameSide =
      first.net === second.net ||
      (isTopRail(first.net) && isTopRail(second.net)) ||
      (isBottomRail(first.net) && isBottomRail(second.net));
    if (isSameSide) {
      loose.push(device);
      continue;
    }
    const firstLevel = levels.get(first.net);
    const secondLevel = levels.get(second.net);
    if (firstLevel !== undefined && firstLevel === secondLevel) {
      const key = [first.net, second.net].sort().join("\u0000");
      const entry = flats.get(key) ?? {
        level: firstLevel,
        nets: [first.net, second.net],
        devices: [],
      };
      entry.devices.push(device);
      flats.set(key, entry);
      continue;
    }
    const rank = (net: string): number =>
      isTopRail(net) ? -1 : isBottomRail(net) ? Infinity : levels.get(net)!;
    const [upper, lower] = rank(first.net) <= rank(second.net) ? [first, second] : [second, first];
    const hasTopCap = isRail(upper.net);
    const hasBottomCap = isRail(lower.net);
    const topLine = hasTopCap
      ? hasBottomCap
        ? 0
        : levels.get(lower.net)! - 1
      : levels.get(upper.net)!;
    const bottomLine = hasBottomCap ? topLine + 1 : levels.get(lower.net)!;
    uprights.push({ device, upper, lower, topLine, bottomLine, hasTopCap, hasBottomCap });
  }

  const items: Item[] = [];
  const taken = new Set<Upright>();
  uprights.sort(
    (left, right) => left.topLine - right.topLine || left.device.line - right.device.line,
  );
  for (const start of uprights) {
    if (taken.has(start)) continue;
    const chain = [start];
    taken.add(start);
    let current = start;
    while (!current.hasBottomCap) {
      const below = current.lower.net;
      const next = uprights.find(
        (candidate) =>
          !taken.has(candidate) && !candidate.hasTopCap && candidate.upper.net === below,
      );
      if (!next) break;
      chain.push(next);
      taken.add(next);
      current = next;
    }
    items.push({ type: "chain", devices: chain });
  }
  for (const entry of flats.values()) {
    // Two devices fit around a line, one on each side; any more show their nodes by name.
    items.push({
      type: "flat",
      level: entry.level,
      nets: entry.nets,
      devices: entry.devices.slice(0, 2),
    });
    loose.push(...entry.devices.slice(2));
  }
  items.push(...loose.map((device): Item => ({ type: "loose", device })));
  return items;
}

// Where each node meets each item, as coordinates along the order. A flat item sits between its
// two nodes, so they meet it a quarter step to its left and right.
function attach(items: Item[], order: number[]): Map<string, Attachment[]> {
  const position = new Map(order.map((item, index) => [item, index]));
  const attachments = new Map<string, Attachment[]>();
  function add(net: string, item: number, coordinate: number): void {
    attachments.set(net, [...(attachments.get(net) ?? []), { item, coordinate }]);
  }
  items.forEach((item, index) => {
    if (item.type !== "chain") return;
    const nets = item.devices.flatMap((upright) => [
      ...(upright.hasTopCap ? [] : [upright.upper.net]),
      ...(upright.hasBottomCap ? [] : [upright.lower.net]),
    ]);
    for (const net of new Set(nets)) add(net, index, position.get(index)!);
  });
  const flats = items.flatMap((item, index) => (item.type === "flat" ? [{ item, index }] : []));
  const meanOf = (net: string, except: number): number | null => {
    const others = [
      ...(attachments.get(net) ?? []).map((entry) => entry.coordinate),
      ...flats
        .filter((flat) => flat.index !== except && flat.item.nets.includes(net))
        .map((flat) => position.get(flat.index)!),
    ];
    return others.length === 0
      ? null
      : others.reduce((sum, value) => sum + value, 0) / others.length;
  };
  const sides = flats.map(({ item, index }) => {
    const here = position.get(index)!;
    const [first, second] = item.nets;
    const [firstMean, secondMean] = [meanOf(first, index), meanOf(second, index)];
    let isFirstLeft = true;
    if (firstMean !== null && secondMean !== null) isFirstLeft = firstMean <= secondMean;
    else if (firstMean !== null) isFirstLeft = firstMean < here;
    else if (secondMean !== null) isFirstLeft = secondMean > here;
    return { index, here, left: isFirstLeft ? first : second, right: isFirstLeft ? second : first };
  });
  for (const side of sides) {
    add(side.left, side.index, side.here - 0.25);
    add(side.right, side.index, side.here + 0.25);
  }
  for (const list of attachments.values())
    list.sort((left, right) => left.coordinate - right.coordinate);
  return attachments;
}

// Counts the places where an order would make a wire cross another net, plus the bus length.
function costOf(items: Item[], order: number[], levels: Map<string, number>): number {
  const attachments = attach(items, order);
  const spans = [...attachments].map(([net, list]) => ({
    level: levels.get(net)!,
    from: list[0].coordinate,
    to: list[list.length - 1].coordinate,
  }));
  let crossings = 0;
  order.forEach((item, position) => {
    const entry = items[item];
    if (entry.type !== "chain") return;
    for (const upright of entry.devices) {
      crossings += spans.filter(
        (span) =>
          upright.topLine < span.level &&
          span.level < upright.bottomLine &&
          span.from <= position &&
          position <= span.to,
      ).length;
    }
  });
  spans.forEach((left, index) => {
    for (const right of spans.slice(index + 1)) {
      if (left.level !== right.level) continue;
      if (Math.max(left.from, right.from) <= Math.min(left.to, right.to)) crossings += 1;
    }
  });
  const pull = order.reduce((sum, item, position) => {
    const entry = items[item];
    const isSteered =
      entry.type === "chain" &&
      entry.devices.some(
        ({ device }) => device.control !== null && !levels.has(device.control.net),
      );
    return sum + (isSteered ? position * CONTROL_PULL : 0);
  }, 0);
  const length = spans.reduce((sum, span) => sum + span.to - span.from, 0);
  return crossings * CROSSING_COST + length + pull;
}

// Moves one item at a time to wherever it lowers the cost, until no move helps.
function orderItems(items: Item[], levels: Map<string, number>): number[] {
  let order = items.map((_, index) => index);
  let cost = costOf(items, order, levels);
  const reach = items.length > 40 ? 6 : items.length;
  for (let pass = 0; pass < 6; pass++) {
    let isImproved = false;
    for (let from = 0; from < order.length; from++) {
      for (
        let to = Math.max(0, from - reach);
        to < Math.min(order.length, from + reach + 1);
        to++
      ) {
        if (to === from) continue;
        const candidate = [...order];
        const [moved] = candidate.splice(from, 1);
        candidate.splice(to, 0, moved);
        const candidateCost = costOf(items, candidate, levels);
        if (candidateCost < cost) {
          order = candidate;
          cost = candidateCost;
          isImproved = true;
        }
      }
    }
    if (!isImproved) break;
  }
  return order;
}

// Splits each node's bus wherever it would cross a device of another net or overlap another bus
// on its line. The pieces are joined by name instead.
function splitIntoFragments(
  items: Item[],
  order: number[],
  levels: Map<string, number>,
): Fragment[] {
  let fragments: Fragment[] = [...attach(items, order)].map(([net, attachments]) => ({
    net,
    level: levels.get(net)!,
    attachments,
  }));

  function cut(fragment: Fragment, blockers: number[]): Fragment[] {
    const parts: Attachment[][] = [[fragment.attachments[0]]];
    for (const attachment of fragment.attachments.slice(1)) {
      const last = parts[parts.length - 1];
      const previous = last[last.length - 1].coordinate;
      if (blockers.some((blocker) => previous < blocker && blocker < attachment.coordinate)) {
        parts.push([attachment]);
      } else last.push(attachment);
    }
    return parts.map((attachments) => ({ ...fragment, attachments }));
  }
  const from = (fragment: Fragment): number => fragment.attachments[0].coordinate;
  const to = (fragment: Fragment): number =>
    fragment.attachments[fragment.attachments.length - 1].coordinate;

  function splitOnce(): boolean {
    for (const [position, item] of order.entries()) {
      const entry = items[item];
      if (entry.type !== "chain") continue;
      for (const upright of entry.devices) {
        const crossed = fragments.find(
          (fragment) =>
            upright.topLine < fragment.level &&
            fragment.level < upright.bottomLine &&
            from(fragment) < position &&
            position < to(fragment),
        );
        if (!crossed) continue;
        fragments = fragments.flatMap((fragment) =>
          fragment === crossed ? cut(fragment, [position]) : [fragment],
        );
        return true;
      }
    }
    for (const [index, left] of fragments.entries()) {
      for (const right of fragments.slice(index + 1)) {
        if (left.level !== right.level) continue;
        if (Math.max(from(left), from(right)) > Math.min(to(left), to(right))) continue;
        const coordinates = (fragment: Fragment): number[] =>
          fragment.attachments.map((attachment) => attachment.coordinate);
        let target = left;
        let parts = cut(left, coordinates(right));
        if (parts.length === 1) {
          target = right;
          parts = cut(right, coordinates(left));
        }
        fragments = fragments.flatMap((fragment) => (fragment === target ? parts : [fragment]));
        return true;
      }
    }
    return false;
  }
  while (splitOnce());
  return fragments;
}

// Draws the cluster into the sketch and returns the points other parts of the circuit may wire to.
function layoutNetwork(devices: Device[], sketch: Sketch): Pin[] {
  const nodes = [
    ...new Set(
      devices.flatMap((device) => device.pins.map((pin) => pin.net)).filter((net) => !isRail(net)),
    ),
  ];
  const levels = assignLevels(devices, nodes);
  const items = buildItems(devices, levels);
  const order = orderItems(items, levels);
  const fragments = splitIntoFragments(items, order, levels);
  const pins: Pin[] = [];
  const lastLine = Math.max(0, ...levels.values()) + 1;

  function valueWidth(device: Device): number {
    return device.value === null ? 0 : sketch.captionWidth(device.value, "value");
  }
  // A device lying flat has no room beside its name, so there the mark is part of the name.
  function shownName(device: Device): string {
    return device.isWeak ? `${device.name} ${WEAK_MARK.text}` : device.name;
  }
  function nameWidth(device: Device): number {
    return sketch.captionWidth({ text: shownName(device), isTex: false }, "name");
  }
  function leftExtent(device: Device): number {
    if (device.control === null) return 16;
    return UPRIGHT_REACH + LABEL_GAP + sketch.netSize(device.control.net).width + 4;
  }
  function rightExtent(device: Device): number {
    const text = Math.max(nameWidth(device), valueWidth(device));
    return Math.max(16, BODY_HALF[device.kind] + NAME_GAP + text + 6);
  }

  // Horizontal positions: a chain or a loose device by its axis, a flat item by its two ends.
  const axis = new Map<number, number>();
  const ends = new Map<number, [number, number]>();
  let cursor = 0;
  for (const index of order) {
    const item = items[index];
    if (item.type === "flat") {
      const text = Math.max(
        ...item.devices.map((device) => nameWidth(device) + valueWidth(device) + 12),
        ...item.devices.map((device) =>
          device.control === null ? 0 : sketch.netSize(device.control.net).width,
        ),
      );
      const width = Math.max(DEVICE_LENGTH + 2 * FLAT_LEAD, text + 8);
      ends.set(index, [cursor, cursor + width]);
      cursor += width + ITEM_GAP;
      continue;
    }
    const members =
      item.type === "chain" ? item.devices.map((upright) => upright.device) : [item.device];
    const x = cursor + Math.max(...members.map(leftExtent));
    axis.set(index, x);
    cursor = x + Math.max(...members.map(rightExtent)) + ITEM_GAP;
  }

  // Vertical positions: gap k lies between line k - 1 and line k and holds the devices whose
  // upper end is line k - 1, with room for caps and for flat items lying on either line.
  const lineY = [0];
  const zoneTop: number[] = [0];
  for (let gap = 1; gap <= lastLine; gap++) {
    const bodies = items.flatMap((item) =>
      item.type === "chain" ? item.devices.filter((upright) => upright.topLine === gap - 1) : [],
    );
    const hasLoose = gap === 1 && items.some((item) => item.type === "loose");
    const top = hasLoose || bodies.some((upright) => upright.hasTopCap) ? CAP_ZONE : 0;
    const bottom = hasLoose || bodies.some((upright) => upright.hasBottomCap) ? CAP_ZONE : 0;
    let height = bodies.length > 0 || hasLoose ? top + DEVICE_LENGTH + bottom : 0;
    for (const item of items) {
      if (item.type !== "flat") continue;
      const isPair = item.devices.length === 2;
      const hasControl = item.devices.some((device) => device.control !== null);
      const controlSide =
        (hasControl ? FLAT_REACH + LABEL_HEIGHT + 10 : 22) + (isPair ? PAIR_OFFSET : 0);
      const nameSide = isPair
        ? controlSide
        : Math.max(...item.devices.map((device) => BODY_HALF[device.kind])) + LABEL_HEIGHT + 12;
      if (item.level === gap) height = Math.max(height, controlSide);
      if (item.level === gap - 1) height = Math.max(height, nameSide);
    }
    zoneTop.push(top);
    lineY.push(lineY[gap - 1] + height);
  }

  function drawUpright(upright: Upright, x: number): void {
    sketch.owned(upright.device.name, () => drawOwnedUpright(upright, x));
  }

  function drawOwnedUpright(upright: Upright, x: number): void {
    const { device, upper, lower } = upright;
    const top = lineY[upright.topLine] + zoneTop[upright.topLine + 1];
    const bottom = top + DEVICE_LENGTH;
    const stub = drawDevice(sketch, device, uprightFrame(x, top), [upper, lower], UPRIGHT_REACH);
    if (stub) {
      pins.push({
        net: device.control!.net,
        x: stub[0],
        y: stub[1],
        side: "left",
        needsLabel: true,
      });
    }
    if (upright.hasTopCap) drawCap(sketch, upper.net, [x, top], -1);
    else if (top > lineY[upright.topLine])
      sketch.wire(upper.net, [x, lineY[upright.topLine]], [x, top]);
    if (upright.hasBottomCap) drawCap(sketch, lower.net, [x, bottom], 1);
    else if (lineY[upright.bottomLine] > bottom) {
      sketch.wire(lower.net, [x, bottom], [x, lineY[upright.bottomLine]]);
    }
    const labelX = x + BODY_HALF[device.kind] + NAME_GAP;
    const middle = top + DEVICE_LENGTH / 2;
    // An upright device shows "(weak)" as part of the symbol, so it stays when names are hidden.
    const nameY = device.value === null ? middle : middle - 9;
    sketch.nameLabel([labelX, nameY], "start", device.name);
    if (device.isWeak) {
      const width = sketch.captionWidth({ text: device.name, isTex: false }, "name");
      sketch.caption([labelX + width + 3, nameY], "start", WEAK_MARK, "caption");
    }
    if (device.value !== null) sketch.caption([labelX, middle + 9], "start", device.value, "value");
  }

  // The left and right node of each flat item, as `attach` decided them.
  const attachments = attach(items, order);
  function sideNets(index: number): [string, string] {
    const item = items[index] as Extract<Item, { type: "flat" }>;
    const coordinateOf = (net: string): number =>
      attachments.get(net)!.find((entry) => entry.item === index)!.coordinate;
    const [first, second] = item.nets;
    return coordinateOf(first) < coordinateOf(second) ? [first, second] : [second, first];
  }

  for (const index of order) {
    const item = items[index];
    if (item.type === "chain") {
      for (const upright of item.devices) drawUpright(upright, axis.get(index)!);
    } else if (item.type === "loose") {
      const [upper, lower] = item.device.pins;
      drawUpright(
        {
          device: item.device,
          upper,
          lower,
          topLine: 0,
          bottomLine: 1,
          hasTopCap: true,
          hasBottomCap: true,
        },
        axis.get(index)!,
      );
    } else {
      const [left, right] = sideNets(index);
      const [x0, x1] = ends.get(index)!;
      const y = lineY[item.level];
      const start = (x0 + x1) / 2 - DEVICE_LENGTH / 2;
      const isPair = item.devices.length === 2;
      item.devices.forEach((device, position) => {
        sketch.owned(device.name, () => {
          const side = position === 0 ? -1 : 1;
          const deviceY = isPair ? y + side * PAIR_OFFSET : y;
          const terminals =
            device.pins[0].net === left
              ? device.pins
              : ([...device.pins].reverse() as [Terminal, Terminal]);
          const stub = drawDevice(
            sketch,
            device,
            flatFrame(start, deviceY, side),
            terminals,
            FLAT_REACH,
          );
          if (stub) sketch.netLabel([stub[0], stub[1] + side * 10], "middle", device.control!.net);
          if (isPair) {
            sketch.wire(left, [x0, y], [x0, deviceY], [start, deviceY]);
            sketch.wire(right, [start + DEVICE_LENGTH, deviceY], [x1, deviceY], [x1, y]);
          } else {
            sketch.wire(left, [x0, y], [start, y]);
            sketch.wire(right, [start + DEVICE_LENGTH, y], [x1, y]);
          }
          const labelY = deviceY - side * (BODY_HALF[device.kind] + 11);
          const center = (x0 + x1) / 2;
          if (device.value === null)
            sketch.nameLabel([center, labelY], "middle", shownName(device));
          else {
            sketch.nameLabel([center - 3, labelY], "end", shownName(device));
            sketch.caption([center + 3, labelY], "start", device.value, "value");
          }
        });
      });
    }
  }

  function xOf(net: string, attachment: Attachment): number {
    const item = items[attachment.item];
    if (item.type !== "flat") return axis.get(attachment.item)!;
    const [x0, x1] = ends.get(attachment.item)!;
    return sideNets(attachment.item)[0] === net ? x0 : x1;
  }

  // How many wire ends meet the bus where an item attaches, not counting the bus itself.
  function branchesAt(net: string, level: number, attachment: Attachment): number {
    const item = items[attachment.item];
    if (item.type === "flat") return item.devices.length;
    if (item.type === "loose") return 0;
    return item.devices.filter(
      (upright) =>
        (!upright.hasTopCap && upright.upper.net === net && upright.topLine === level) ||
        (!upright.hasBottomCap && upright.lower.net === net && upright.bottomLine === level),
    ).length;
  }

  for (const fragment of fragments) {
    const y = lineY[fragment.level];
    const xs = fragment.attachments.map((attachment) => xOf(fragment.net, attachment));
    const [from, to] = [Math.min(...xs), Math.max(...xs)];
    if (to > from) sketch.wire(fragment.net, [from, y], [to, y]);
    fragment.attachments.forEach((attachment, index) => {
      const x = xs[index];
      const onBus = Number(x > from) + Number(x < to);
      if (onBus + branchesAt(fragment.net, fragment.level, attachment) >= 3)
        sketch.dot(fragment.net, [x, y]);
    });
    pins.push({ net: fragment.net, x: from, y, side: "left", needsLabel: false });
    pins.push({ net: fragment.net, x: to, y, side: "right", needsLabel: false });
  }

  // Every bus carries its node's name: above the line beside an attachment where there is room,
  // otherwise below it or past one of its ends.
  const obstacles = obstaclesOf(sketch.primitives);
  for (const fragment of fragments) {
    const y = lineY[fragment.level];
    const xs = fragment.attachments.map((attachment) => xOf(fragment.net, attachment));
    const [from, to] = [Math.min(...xs), Math.max(...xs)];
    const beside = [...xs].reverse();
    const candidates: { point: Point; anchor: "start" | "end" }[] = [
      ...beside.map((x) => ({ point: [x + NAME_GAP, y - 11] as Point, anchor: "start" as const })),
      ...beside.map((x) => ({ point: [x + NAME_GAP, y + 11] as Point, anchor: "start" as const })),
      { point: [to + 6, y], anchor: "start" },
      { point: [from - 6, y], anchor: "end" },
    ];
    const size = sketch.netSize(fragment.net);
    const boxAt = (candidate: (typeof candidates)[number]) =>
      labelBox({ x: candidate.point[0], y: candidate.point[1], anchor: candidate.anchor, ...size });
    const chosen =
      candidates.find((candidate) => isBoxFree(obstacles, boxAt(candidate))) ?? candidates[0];
    sketch.netLabel(chosen.point, chosen.anchor, fragment.net);
    obstacles.push({ box: boxAt(chosen), net: fragment.net, isWire: false });
  }

  return pins;
}

export { assignLevels, layoutNetwork };
