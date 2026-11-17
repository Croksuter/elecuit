// role: draws one device symbol along an axis, upright or lying down, and the cap that ends a lead.

import type { Point, Sketch } from "./drawing";
import { isBottomRail, isTopRail } from "./netlist";
import type { Device, DeviceKind, Terminal } from "./netlist";

// Maps a position along the device axis (0 at the first pin, DEVICE_LENGTH at the second) and
// across it (negative on the control side, positive on the name side) to the sketch.
type Frame = (along: number, across: number) => Point;

const DEVICE_LENGTH = 64;
const CAP_STUB = 12;
// Room a cap takes beyond the end of a lead: stub, symbol and its label.
const CAP_ZONE = 34;
// How far each symbol reaches from its axis on the name side.
const BODY_HALF: Record<DeviceKind, number> = {
  nmos: 0,
  pmos: 0,
  npn: 0,
  pnp: 0,
  res: 6,
  cap: 11,
  ind: 6,
  switch: 10,
  diode: 9,
  zener: 9,
  led: 22,
  vsrc: 14,
  isrc: 14,
};

function upright(x: number, y: number): Frame {
  return (along, across) => [x + across, y + along];
}

// `side` is -1 to put the control side above the axis and 1 to put it below.
function flat(x: number, y: number, side: -1 | 1): Frame {
  return (along, across) => [x + along, y - side * across];
}

// An open arrowhead at `tip` for a stroke arriving from `from`.
function arrowHead(sketch: Sketch, from: Point, tip: Point, size: number): void {
  const length = Math.hypot(tip[0] - from[0], tip[1] - from[1]);
  const [dx, dy] = [(tip[0] - from[0]) / length, (tip[1] - from[1]) / length];
  const back: Point = [tip[0] - dx * size, tip[1] - dy * size];
  sketch.stroke([
    [back[0] - (dy * size) / 2, back[1] + (dx * size) / 2],
    tip,
    [back[0] + (dy * size) / 2, back[1] - (dx * size) / 2],
  ]);
}

// Draws the device with `first` at the start of the axis and `second` at its end. Returns where
// the control stub ends, or null for a device without a control terminal.
function drawDevice(
  sketch: Sketch,
  device: Device,
  frame: Frame,
  [first, second]: [Terminal, Terminal],
  reach: number,
): Point | null {
  const { kind } = device;
  const end = DEVICE_LENGTH;

  if (kind === "nmos" || kind === "pmos") {
    sketch.wire(first.net, frame(0, 0), frame(14, 0), frame(14, -12));
    sketch.wire(second.net, frame(50, -12), frame(50, 0), frame(end, 0));
    sketch.stroke([frame(10, -12), frame(54, -12)], { isHeavy: true, device: device.name });
    sketch.stroke([frame(14, -20), frame(50, -20)]);
    if (kind === "pmos") sketch.circle(frame(32, -24), 3.5);
    sketch.wire(device.control!.net, frame(32, kind === "pmos" ? -27.5 : -20), frame(32, -reach));
    return frame(32, -reach);
  }

  if (kind === "npn" || kind === "pnp") {
    sketch.wire(first.net, frame(0, 0), frame(14, 0), frame(26, -12));
    sketch.wire(second.net, frame(38, -12), frame(50, 0), frame(end, 0));
    sketch.stroke([frame(18, -12), frame(46, -12)], { isHeavy: true });
    // The arrow sits on the emitter lead: pointing away from the base for npn, at it for pnp.
    const [atBase, atElbow] =
      first.key === "e" ? [frame(26, -12), frame(14, 0)] : [frame(38, -12), frame(50, 0)];
    const along = (share: number): Point => [
      atBase[0] + (atElbow[0] - atBase[0]) * share,
      atBase[1] + (atElbow[1] - atBase[1]) * share,
    ];
    if (kind === "npn") arrowHead(sketch, atBase, along(0.85), 7);
    else arrowHead(sketch, atElbow, along(0.3), 7);
    sketch.wire(device.control!.net, frame(32, -12), frame(32, -reach));
    return frame(32, -reach);
  }

  if (kind === "vsrc" || kind === "isrc") {
    sketch.wire(first.net, frame(0, 0), frame(18, 0));
    sketch.wire(second.net, frame(46, 0), frame(end, 0));
    sketch.circle(frame(32, 0), 14);
    const [nearPositive, nearNegative] = first.key === "p" ? [24, 40] : [40, 24];
    if (kind === "isrc") {
      // The arrow points from p to n, the way the current flows through the source.
      const tip = frame(nearNegative + (nearNegative > 32 ? 2 : -2), 0);
      sketch.stroke([frame(nearPositive, 0), tip]);
      arrowHead(sketch, frame(nearPositive, 0), tip, 6);
    } else {
      const [px, py] = frame(nearPositive, 0);
      const [nx, ny] = frame(nearNegative, 0);
      sketch.stroke([
        [px - 3, py],
        [px + 3, py],
      ]);
      sketch.stroke([
        [px, py - 3],
        [px, py + 3],
      ]);
      sketch.stroke([
        [nx - 3, ny],
        [nx + 3, ny],
      ]);
    }
    return null;
  }

  if (kind === "diode" || kind === "zener" || kind === "led") {
    const [base, tip] = first.key === "a" ? [22, 42] : [42, 22];
    const toward = Math.sign(tip - base);
    sketch.wire(first.net, frame(0, 0), frame(22, 0));
    sketch.wire(second.net, frame(42, 0), frame(end, 0));
    sketch.stroke([frame(base, -9), frame(base, 9), frame(tip, 0)], { isClosed: true });
    sketch.stroke(
      kind === "zener"
        ? [frame(tip - 4 * toward, -9), frame(tip, -9), frame(tip, 9), frame(tip + 4 * toward, 9)]
        : [frame(tip, -9), frame(tip, 9)],
    );
    if (kind === "led") {
      for (const offset of [2, 10]) {
        const from = frame(base + toward * offset, 12);
        const to = frame(base + toward * (offset + 6), 20);
        sketch.stroke([from, to]);
        arrowHead(sketch, from, to, 4);
      }
    }
    return null;
  }

  if (kind === "res") {
    sketch.wire(first.net, frame(0, 0), frame(14, 0));
    sketch.wire(second.net, frame(50, 0), frame(end, 0));
    const turns = [17, 23, 29, 35, 41, 47].map((along, index) => frame(along, index % 2 ? -6 : 6));
    sketch.stroke([frame(14, 0), ...turns, frame(50, 0)]);
    return null;
  }

  if (kind === "cap") {
    sketch.wire(first.net, frame(0, 0), frame(29, 0));
    sketch.wire(second.net, frame(35, 0), frame(end, 0));
    sketch.stroke([frame(29, -11), frame(29, 11)], { isHeavy: true });
    sketch.stroke([frame(35, -11), frame(35, 11)], { isHeavy: true });
    return null;
  }

  if (kind === "ind") {
    sketch.wire(first.net, frame(0, 0), frame(14, 0));
    sketch.wire(second.net, frame(50, 0), frame(end, 0));
    const humps = [0, 1, 2, 3].map((index) => {
      const [cx, cy] = frame(18.5 + 9 * index, 12);
      const [x, y] = frame(23 + 9 * index, 0);
      return `Q${cx} ${cy} ${x} ${y}`;
    });
    const [x, y] = frame(14, 0);
    sketch.shape(`M${x} ${y}${humps.join("")}`);
    return null;
  }

  // switch
  sketch.wire(first.net, frame(0, 0), frame(22, 0));
  sketch.wire(second.net, frame(42, 0), frame(end, 0));
  sketch.stroke([frame(22, 0), frame(40, 10)]);
  sketch.circle(frame(22, 0), 2.5);
  sketch.circle(frame(42, 0), 2.5);
  return null;
}

// Ends a lead at `point` going up (-1) or down (1): a rail symbol where the rail belongs on that
// side, the net's name otherwise.
function drawCap(sketch: Sketch, net: string, [x, y]: Point, direction: -1 | 1): void {
  const end = y + direction * CAP_STUB;
  sketch.wire(net, [x, y], [x, end]);
  if (net === "GND" && direction === 1) {
    sketch.wire(net, [x - 11, end], [x + 11, end]);
    sketch.wire(net, [x - 7, end + 5], [x + 7, end + 5]);
    sketch.wire(net, [x - 3, end + 10], [x + 3, end + 10]);
    return;
  }
  const isRailSide = (isTopRail(net) && direction === -1) || (isBottomRail(net) && direction === 1);
  if (isRailSide) sketch.wire(net, [x - 10, end], [x + 10, end]);
  sketch.netLabel([x, end + direction * 11], "middle", net);
}

export { BODY_HALF, CAP_ZONE, DEVICE_LENGTH, drawCap, drawDevice, flat, upright };
