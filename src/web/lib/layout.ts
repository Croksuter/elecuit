// role: places a circuit as drawing primitives; wires only where geometry is proven clear, names elsewhere.

import { isGate, isRail, isTransistor } from "./netlist";
import type { Capacitor, Circuit, Gate, Transistor } from "./netlist";

type Point = [number, number];
type LabelKind = "net" | "name" | "value";
type TextAnchor = "start" | "middle" | "end";

type Primitive =
  | { type: "wire"; net: string; points: Point[] }
  | { type: "dot"; net: string; x: number; y: number }
  | { type: "shape"; d: string; isHeavy: boolean }
  | { type: "circle"; x: number; y: number; r: number }
  | {
      type: "label";
      x: number;
      y: number;
      anchor: TextAnchor;
      text: string;
      isTex: boolean;
      kind: LabelKind;
      net: string | null;
      width: number;
      height: number;
    };

interface Drawing {
  primitives: Primitive[];
  width: number;
  height: number;
  notes: string[];
}

type Measure = (text: string, isTex: boolean, kind: LabelKind) => { width: number; height: number };

type Tree =
  | { kind: "device"; device: Transistor; top: string; bottom: string }
  | { kind: "series"; children: Tree[]; mids: string[]; top: string; bottom: string }
  | { kind: "parallel"; children: Tree[]; top: string; bottom: string };

interface Block {
  left: number;
  right: number;
  height: number;
  draw(portX: number, topY: number, isSpine: boolean): void;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface WireAnchor {
  net: string;
  x: number;
  y: number;
  owner: number;
  isConsumed: boolean;
  needsLabel: boolean;
}

const DEVICE_HEIGHT = 64;
const CHANNEL_INSET = 14;
const GATE_REACH = 48;
const LABEL_GAP = 4;
const NAME_GAP = 8;
const BUS = 12;
const BRANCH_GAP = 20;
const RAIL_STUB = 12;
const TERMINAL_STUB = 16;
const ELEMENT_GAP = 48;
const PIN_PITCH = 16;
const PIN_LEAD = 16;
const TOP = 40;
const MARGIN = 16;
const WIRE_CLEARANCE = 6;

function flip(tree: Tree): Tree {
  if (tree.kind === "device") return { ...tree, top: tree.bottom, bottom: tree.top };
  if (tree.kind === "parallel") {
    return { ...tree, children: tree.children.map(flip), top: tree.bottom, bottom: tree.top };
  }
  return {
    ...tree,
    children: tree.children.map(flip).reverse(),
    mids: [...tree.mids].reverse(),
    top: tree.bottom,
    bottom: tree.top,
  };
}

// Reduces channel edges to one VDD–GND edge by series and parallel steps.
// Returns null when the network is not series-parallel between the rails.
function reduceSeriesParallel(devices: Transistor[]): Tree | null {
  let edges: Tree[] = devices.map((device) => ({
    kind: "device",
    device,
    top: device.d,
    bottom: device.s,
  }));
  let isChanged = true;
  while (isChanged && edges.length > 1) {
    isChanged = false;

    const groups = new Map<string, Tree[]>();
    for (const edge of edges) {
      const key = [edge.top, edge.bottom].sort().join("\u0000");
      groups.set(key, [...(groups.get(key) ?? []), edge]);
    }
    const merged: Tree[] = [];
    for (const group of groups.values()) {
      if (group.length === 1) {
        merged.push(group[0]);
        continue;
      }
      const [first] = group;
      const children = group
        .map((edge) => (edge.top === first.top ? edge : flip(edge)))
        .flatMap((edge) => (edge.kind === "parallel" ? edge.children : [edge]));
      merged.push({ kind: "parallel", children, top: first.top, bottom: first.bottom });
      isChanged = true;
    }
    edges = merged;

    const degree = new Map<string, Tree[]>();
    for (const edge of edges) {
      for (const net of [edge.top, edge.bottom]) {
        if (!isRail(net)) degree.set(net, [...(degree.get(net) ?? []), edge]);
      }
    }
    for (const [middle, incident] of degree) {
      if (incident.length !== 2) continue;
      let [upper, lower] = incident;
      if (upper.bottom !== middle) upper = flip(upper);
      if (lower.top !== middle) lower = flip(lower);
      if (upper.top === lower.bottom) continue;
      const parts = [upper, lower];
      const children = parts.flatMap((edge) => (edge.kind === "series" ? edge.children : [edge]));
      const mids = [
        ...(upper.kind === "series" ? upper.mids : []),
        middle,
        ...(lower.kind === "series" ? lower.mids : []),
      ];
      const series: Tree = { kind: "series", children, mids, top: upper.top, bottom: lower.bottom };
      edges = [...edges.filter((edge) => !incident.includes(edge)), series];
      isChanged = true;
      break;
    }
  }
  if (edges.length !== 1) return null;
  const [root] = edges;
  if (root.top === "VDD" && root.bottom === "GND") return root;
  if (root.top === "GND" && root.bottom === "VDD") return flip(root);
  return null;
}

// Groups transistors whose channels share a non-rail node into stages.
function findStages(transistors: Transistor[]): Transistor[][] {
  const parent = new Map<string, string>();
  function find(key: string): string {
    while (parent.get(key) !== key) key = parent.get(key)!;
    return key;
  }
  function keyOf(device: Transistor): string {
    if (!isRail(device.d)) return `net:${device.d}`;
    if (!isRail(device.s)) return `net:${device.s}`;
    return `device:${device.name}`;
  }
  for (const device of transistors) {
    for (const key of [
      keyOf(device),
      ...[device.d, device.s].filter((net) => !isRail(net)).map((net) => `net:${net}`),
    ]) {
      if (!parent.has(key)) parent.set(key, key);
    }
    const root = find(keyOf(device));
    for (const net of [device.d, device.s]) {
      if (!isRail(net)) parent.set(find(`net:${net}`), root);
    }
  }
  const stages = new Map<string, Transistor[]>();
  for (const device of transistors) {
    const root = find(keyOf(device));
    stages.set(root, [...(stages.get(root) ?? []), device]);
  }
  return [...stages.values()];
}

// Removes devices hanging off a node that has only one channel connection.
function peelDangling(devices: Transistor[]): { core: Transistor[]; loose: Transistor[] } {
  let core = devices.filter((device) => device.d !== device.s);
  const loose = devices.filter((device) => device.d === device.s);
  let isChanged = true;
  while (isChanged) {
    isChanged = false;
    const count = new Map<string, number>();
    for (const device of core) {
      for (const net of [device.d, device.s]) count.set(net, (count.get(net) ?? 0) + 1);
    }
    const dangling = core.filter((device) =>
      [device.d, device.s].some((net) => !isRail(net) && count.get(net) === 1),
    );
    if (dangling.length > 0) {
      loose.push(...dangling);
      core = core.filter((device) => !dangling.includes(device));
      isChanged = true;
    }
  }
  return { core, loose };
}

function layout(circuit: Circuit, measure: Measure): Drawing {
  const primitives: Primitive[] = [];
  const notes: string[] = [];
  const boxes: Box[] = [];
  const anchors: WireAnchor[] = [];

  function texOf(net: string): string {
    if (net === "VDD") return "V_{DD}";
    if (net === "GND") return "\\mathrm{GND}";
    const label = circuit.labels.get(net);
    return label ? label.tex : `\\mathit{${net.replace(/_/g, "\\_")}}`;
  }

  function wire(net: string, ...points: Point[]): void {
    primitives.push({ type: "wire", net, points });
  }

  function label(
    x: number,
    y: number,
    anchor: TextAnchor,
    text: string,
    options: { isTex: boolean; kind: LabelKind; net: string | null },
  ): void {
    const size = measure(text, options.isTex, options.kind);
    primitives.push({ type: "label", x, y, anchor, text, ...options, ...size });
  }

  function netLabel(x: number, y: number, anchor: TextAnchor, net: string): void {
    label(x, y, anchor, texOf(net), { isTex: true, kind: "net", net });
  }

  function nameLabel(x: number, y: number, anchor: TextAnchor, name: string): void {
    label(x, y, anchor, name, { isTex: false, kind: "name", net: null });
  }

  function netWidth(net: string): number {
    return measure(texOf(net), true, "net").width;
  }

  function nameWidth(name: string): number {
    return measure(name, false, "name").width;
  }

  function supply(x: number, y: number): void {
    wire("VDD", [x - 10, y], [x + 10, y]);
    netLabel(x, y - 11, "middle", "VDD");
  }

  function ground(x: number, y: number): void {
    wire("GND", [x - 11, y], [x + 11, y]);
    wire("GND", [x - 7, y + 5], [x + 7, y + 5]);
    wire("GND", [x - 3, y + 10], [x + 3, y + 10]);
  }

  // Ends a terminal lead going up (direction -1) or down (+1) with a rail symbol or a name.
  function terminal(x: number, y: number, direction: 1 | -1, net: string): void {
    const end = y + direction * TERMINAL_STUB;
    wire(net, [x, y], [x, end]);
    if (net === "VDD" && direction === -1) supply(x, end);
    else if (net === "GND" && direction === 1) ground(x, end);
    else netLabel(x, end + direction * 11, "middle", net);
  }

  function drawTransistor(
    device: Transistor,
    top: string,
    bottom: string,
    x: number,
    y: number,
  ): void {
    const bottomY = y + DEVICE_HEIGHT;
    const upper = y + CHANNEL_INSET;
    const lower = bottomY - CHANNEL_INSET;
    const middle = (upper + lower) / 2;
    wire(top, [x, y], [x, upper], [x - 12, upper]);
    wire(bottom, [x - 12, lower], [x, lower], [x, bottomY]);
    primitives.push({ type: "shape", d: `M${x - 12} ${upper - 4}V${lower + 4}`, isHeavy: true });
    primitives.push({ type: "shape", d: `M${x - 20} ${upper}V${lower}`, isHeavy: false });
    let gateStart = x - 20;
    if (device.kind === "pmos") {
      primitives.push({ type: "circle", x: x - 24, y: middle, r: 3.5 });
      gateStart = x - 27.5;
    }
    wire(device.g, [gateStart, middle], [x - GATE_REACH, middle]);
    netLabel(x - GATE_REACH - LABEL_GAP, middle, "end", device.g);
    nameLabel(x + NAME_GAP, middle, "start", device.name);
  }

  function blockOf(tree: Tree, exposed: Set<string>): Block {
    if (tree.kind === "device") {
      return {
        left: GATE_REACH + LABEL_GAP + netWidth(tree.device.g) + 4,
        right: NAME_GAP + nameWidth(tree.device.name) + 6,
        height: DEVICE_HEIGHT,
        draw(x, y) {
          drawTransistor(tree.device, tree.top, tree.bottom, x, y);
        },
      };
    }

    const children = tree.children.map((child) => blockOf(child, exposed));

    if (tree.kind === "series") {
      const midsReach = tree.mids.map((net) => NAME_GAP + netWidth(net) + 6);
      return {
        left: Math.max(...children.map((child) => child.left)),
        right: Math.max(...children.map((child) => child.right), ...midsReach),
        height: children.reduce((sum, child) => sum + child.height, 0),
        draw(x, y, isSpine) {
          let cursor = y;
          children.forEach((child, index) => {
            child.draw(x, cursor, isSpine);
            cursor += child.height;
            if (index === children.length - 1) return;
            const net = tree.mids[index];
            netLabel(x + NAME_GAP, cursor - 11, "start", net);
            if (isSpine && exposed.has(net)) {
              anchors.push({
                net,
                x,
                y: cursor,
                owner: boxes.length,
                isConsumed: false,
                needsLabel: false,
              });
            }
          });
        },
      };
    }

    // Parallel: the branch carrying an exposed node (else the largest) stays on the spine, rightmost,
    // so a wire leaving that node to the right crosses no other branch.
    function score(child: Tree, index: number): number {
      const internal = new Set<string>();
      (function collect(node: Tree): void {
        if (node.kind === "series") node.mids.forEach((net) => internal.add(net));
        if (node.kind !== "device") node.children.forEach(collect);
      })(child);
      const hasExposed = [...internal].some((net) => exposed.has(net));
      return (hasExposed ? 1e6 : 0) + countDevices(child) * 1000 - index;
    }
    const scores = tree.children.map(score);
    const spine = scores.indexOf(Math.max(...scores));
    const order = [...children.keys()].filter((index) => index !== spine).concat(spine);
    const offsets: number[] = [];
    let offset = 0;
    for (let position = order.length - 1; position >= 0; position--) {
      const child = children[order[position]];
      if (position < order.length - 1) {
        const previous = children[order[position + 1]];
        offset -= previous.left + BRANCH_GAP + child.right;
      }
      offsets[position] = offset;
    }
    const tallest = Math.max(...children.map((child) => child.height));
    const height = tallest + 2 * BUS;
    return {
      left: -offsets[0] + children[order[0]].left,
      right: children[spine].right,
      height,
      draw(x, y, isSpine) {
        const ports = offsets.map((value) => x + value);
        wire(tree.top, [ports[0], y], [x, y]);
        wire(tree.bottom, [ports[0], y + height], [x, y + height]);
        order.forEach((childIndex, position) => {
          const child = children[childIndex];
          const port = ports[position];
          wire(tree.top, [port, y], [port, y + BUS]);
          child.draw(port, y + BUS, isSpine && childIndex === spine);
          wire(tree.bottom, [port, y + BUS + child.height], [port, y + height]);
          if (position > 0) {
            primitives.push({ type: "dot", net: tree.top, x: port, y });
            primitives.push({ type: "dot", net: tree.bottom, x: port, y: y + height });
          }
        });
      },
    };
  }

  function countDevices(tree: Tree): number {
    if (tree.kind === "device") return 1;
    return tree.children.reduce((sum, child) => sum + countDevices(child), 0);
  }

  // Records the bounding box of everything drawn since `start` as one placed element.
  function closeElement(start: number): Box {
    const box = boundsOf(primitives.slice(start));
    boxes.push(box);
    return box;
  }

  let cursor = MARGIN;

  const transistors = circuit.elements.filter(isTransistor);
  const gates = circuit.elements.filter(isGate);
  const capacitors = circuit.elements.filter(
    (element): element is Capacitor => element.kind === "cap",
  );

  const consumers = new Set<string>([...gates.flatMap((gate) => gate.inputs)]);
  for (const entry of circuit.outputs) consumers.add(entry.net);

  const looseDevices: Transistor[] = [];
  for (const stage of findStages(transistors)) {
    const { core, loose } = peelDangling(stage);
    const tree = core.length > 0 ? reduceSeriesParallel(core) : null;
    if (tree === null) {
      looseDevices.push(...core, ...loose);
      if (core.length > 0) {
        notes.push(
          `${core.map((device) => device.name).join(", ")}: VDD–GND 사이 직렬·병렬 구조가 아니라 소자별로 따로 그리고 노드 이름으로 연결했습니다.`,
        );
      }
      continue;
    }
    looseDevices.push(...loose);
    const block = blockOf(tree, consumers);
    const start = primitives.length;
    const x = cursor + block.left;
    supply(x, TOP);
    wire("VDD", [x, TOP], [x, TOP + RAIL_STUB]);
    block.draw(x, TOP + RAIL_STUB, true);
    const bottom = TOP + RAIL_STUB + block.height;
    wire("GND", [x, bottom], [x, bottom + RAIL_STUB]);
    ground(x, bottom + RAIL_STUB);
    cursor = closeElement(start).x1 + ELEMENT_GAP;
  }

  for (const device of looseDevices.sort((left, right) => left.line - right.line)) {
    const start = primitives.length;
    const [top, bottom] = device.kind === "pmos" ? [device.s, device.d] : [device.d, device.s];
    const x = cursor + GATE_REACH + LABEL_GAP + netWidth(device.g) + 4;
    const y = TOP + RAIL_STUB;
    drawTransistor(device, top, bottom, x, y);
    terminal(x, y, -1, top);
    terminal(x, y + DEVICE_HEIGHT, 1, bottom);
    cursor = closeElement(start).x1 + ELEMENT_GAP;
  }

  function overlapsWire(y: number, x0: number, x1: number, after: number): boolean {
    return boxes
      .slice(after + 1)
      .some(
        (box) =>
          box.x1 > x0 && box.x0 < x1 && box.y0 - WIRE_CLEARANCE < y && box.y1 + WIRE_CLEARANCE > y,
      );
  }

  for (const gate of orderGates(gates)) {
    const start = primitives.length;
    const count = gate.inputs.length;
    const isSingle = gate.kind === "inv" || gate.kind === "buf";
    const bodyHeight = isSingle ? 28 : Math.max(32, count * PIN_PITCH + 8);
    const bodyWidth = isSingle ? 26 : Math.max(34, bodyHeight / 2 + 12);
    const reach = PIN_LEAD + LABEL_GAP + Math.max(...gate.inputs.map(netWidth)) + 4;
    const bodyX = cursor + reach;
    const pinOffset = (index: number): number => (index - (count - 1) / 2) * PIN_PITCH;

    let centerY = TOP + RAIL_STUB + DEVICE_HEIGHT;
    let anchoredIndex = -1;
    for (let index = 0; index < count && anchoredIndex < 0; index++) {
      const anchor = anchors.find((entry) => entry.net === gate.inputs[index] && !entry.isConsumed);
      if (!anchor) continue;
      if (overlapsWire(anchor.y, anchor.x, bodyX, anchor.owner)) continue;
      anchoredIndex = index;
      centerY = anchor.y - pinOffset(index);
      anchor.isConsumed = true;
      wire(anchor.net, [anchor.x, anchor.y], [bodyX - PIN_LEAD, anchor.y]);
      if (anchor.needsLabel) {
        netLabel((anchor.x + bodyX - PIN_LEAD) / 2, anchor.y - 11, "middle", anchor.net);
      } else {
        primitives.push({ type: "dot", net: anchor.net, x: anchor.x, y: anchor.y });
      }
    }

    const y0 = centerY - bodyHeight / 2;
    const y1 = centerY + bodyHeight / 2;
    let body: string;
    let inset = (_y: number): number => 0;
    if (isSingle) {
      body = `M${bodyX} ${y0}L${bodyX + bodyWidth} ${centerY}L${bodyX} ${y1}Z`;
    } else if (gate.kind === "and" || gate.kind === "nand") {
      const arc = bodyHeight / 2;
      body = `M${bodyX} ${y0}H${bodyX + bodyWidth - arc}A${arc} ${arc} 0 0 1 ${bodyX + bodyWidth - arc} ${y1}H${bodyX}Z`;
    } else {
      const depth = bodyWidth * 0.25;
      body =
        `M${bodyX} ${y0}Q${bodyX + bodyWidth * 0.6} ${y0} ${bodyX + bodyWidth} ${centerY}` +
        `Q${bodyX + bodyWidth * 0.6} ${y1} ${bodyX} ${y1}Q${bodyX + depth} ${centerY} ${bodyX} ${y0}Z`;
      inset = (y) => {
        const t = (y1 - y) / (y1 - y0);
        return 2 * t * (1 - t) * depth;
      };
    }
    primitives.push({ type: "shape", d: body, isHeavy: false });
    nameLabel(bodyX + bodyWidth / 2, y0 - 9, "middle", gate.name);

    gate.inputs.forEach((net, index) => {
      const y = centerY + pinOffset(index);
      wire(net, [bodyX - PIN_LEAD, y], [bodyX + inset(y), y]);
      if (index !== anchoredIndex) netLabel(bodyX - PIN_LEAD - LABEL_GAP, y, "end", net);
    });

    let outX = bodyX + bodyWidth;
    if (gate.kind === "inv" || gate.kind === "nand" || gate.kind === "nor") {
      primitives.push({ type: "circle", x: outX + 3.5, y: centerY, r: 3.5 });
      outX += 7;
    }
    wire(gate.output, [outX, centerY], [outX + PIN_LEAD, centerY]);
    const box = closeElement(start);
    anchors.push({
      net: gate.output,
      x: outX + PIN_LEAD,
      y: centerY,
      owner: boxes.length - 1,
      isConsumed: false,
      needsLabel: true,
    });
    cursor = box.x1 + ELEMENT_GAP;
  }

  for (const anchor of anchors) {
    if (anchor.isConsumed || !anchor.needsLabel) continue;
    wire(anchor.net, [anchor.x, anchor.y], [anchor.x + 8, anchor.y]);
    netLabel(anchor.x + 8 + LABEL_GAP, anchor.y, "start", anchor.net);
  }

  for (const capacitor of capacitors) {
    const start = primitives.length;
    const x = cursor;
    const middle = TOP + RAIL_STUB + DEVICE_HEIGHT / 2;
    primitives.push({ type: "shape", d: `M${x - 11} ${middle - 3}H${x + 11}`, isHeavy: true });
    primitives.push({ type: "shape", d: `M${x - 11} ${middle + 3}H${x + 11}`, isHeavy: true });
    wire(capacitor.a, [x, middle - 3], [x, middle - 3 - TERMINAL_STUB]);
    terminal(x, middle - 3 - TERMINAL_STUB, -1, capacitor.a);
    wire(capacitor.b, [x, middle + 3], [x, middle + 3 + TERMINAL_STUB]);
    terminal(x, middle + 3 + TERMINAL_STUB, 1, capacitor.b);
    nameLabel(x + 16, capacitor.value === null ? middle : middle - 9, "start", capacitor.name);
    if (capacitor.value !== null) {
      label(x + 16, middle + 9, "start", capacitor.value, {
        isTex: true,
        kind: "value",
        net: null,
      });
    }
    cursor = closeElement(start).x1 + ELEMENT_GAP;
  }

  const bounds = boundsOf(primitives);
  const shiftX = MARGIN - bounds.x0;
  const shiftY = MARGIN - bounds.y0;
  const shifted = primitives.map((primitive) => shift(primitive, shiftX, shiftY));
  return {
    primitives: shifted,
    width: primitives.length === 0 ? 0 : bounds.x1 - bounds.x0 + 2 * MARGIN,
    height: primitives.length === 0 ? 0 : bounds.y1 - bounds.y0 + 2 * MARGIN,
    notes,
  };
}

// Places a gate after the gates that drive its inputs, keeping netlist order otherwise.
function orderGates(gates: Gate[]): Gate[] {
  const ordered: Gate[] = [];
  const remaining = [...gates];
  const pending = (net: string): boolean => remaining.some((gate) => gate.output === net);
  while (remaining.length > 0) {
    const ready = remaining.find((gate) => !gate.inputs.some(pending)) ?? remaining[0];
    ordered.push(ready);
    remaining.splice(remaining.indexOf(ready), 1);
  }
  return ordered;
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

// Shifts absolute path commands (M, L, H, V, Q, A, Z) produced by this module.
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

function boundsOf(primitives: Primitive[]): Box {
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  function include(x: number, y: number): void {
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x);
    box.y1 = Math.max(box.y1, y);
  }
  for (const primitive of primitives) {
    if (primitive.type === "wire") primitive.points.forEach(([x, y]) => include(x, y));
    else if (primitive.type === "dot") include(primitive.x, primitive.y);
    else if (primitive.type === "circle") {
      include(primitive.x - primitive.r, primitive.y - primitive.r);
      include(primitive.x + primitive.r, primitive.y + primitive.r);
    } else if (primitive.type === "label") {
      const x0 =
        primitive.anchor === "start"
          ? primitive.x
          : primitive.anchor === "middle"
            ? primitive.x - primitive.width / 2
            : primitive.x - primitive.width;
      include(x0, primitive.y - primitive.height / 2);
      include(x0 + primitive.width, primitive.y + primitive.height / 2);
    } else {
      pathPoints(primitive.d).forEach(([x, y]) => include(x, y));
    }
  }
  if (box.x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return box;
}

// Endpoints and control points of a path from this module, enough for a bounding box.
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

export type { Drawing, LabelKind, Measure, Primitive, TextAnchor };
export { layout, reduceSeriesParallel };
