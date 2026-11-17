// role: draws one block (logic gate, op-amp, flip-flop, box) with its input pins left and outputs right.

import type { Point, Sketch } from "./drawing";
import type { Block, Caption, Device, Terminal } from "./netlist";
import type { Pin } from "./place";
import { BODY_HALF, DEVICE_LENGTH, drawDevice, flat } from "./symbols";

const PIN_PITCH = 16;
const PIN_LEAD = 16;
const BUBBLE = 3.5;
const BOX_TITLES: Partial<Record<Block["kind"], string>> = {
  mux: "MUX",
  dff: "DFF",
  latch: "LATCH",
};
// What a box prints beside each of its pins; a mux numbers its data inputs instead.
const PIN_CAPTIONS: Record<string, Caption> = {
  d: { text: "D", isTex: false },
  en: { text: "EN", isTex: false },
  set: { text: "S", isTex: false },
  rst: { text: "R", isTex: false },
  sel: { text: "S", isTex: false },
  q: { text: "Q", isTex: false },
  qb: { text: "\\overline{Q}", isTex: true },
};

function drawGate(block: Block, sketch: Sketch): Pin[] {
  const { kind } = block;
  const count = block.inputs.length;
  const isSingle = kind === "inv" || kind === "buf";
  const height = isSingle ? 28 : Math.max(32, count * PIN_PITCH + 8);
  const width = isSingle ? 26 : Math.max(34, height / 2 + 12);
  const [y0, y1] = [-height / 2, height / 2];
  // How far the back of the body bulges right at height y; input leads stop there.
  let inset = (_y: number): number => 0;
  if (isSingle) {
    sketch.shape(`M0 ${y0}L${width} 0L0 ${y1}Z`);
  } else if (kind === "and" || kind === "nand") {
    const arc = height / 2;
    sketch.shape(`M0 ${y0}H${width - arc}A${arc} ${arc} 0 0 1 ${width - arc} ${y1}H0Z`);
  } else {
    const depth = width * 0.25;
    sketch.shape(
      `M0 ${y0}Q${width * 0.6} ${y0} ${width} 0Q${width * 0.6} ${y1} 0 ${y1}Q${depth} 0 0 ${y0}Z`,
    );
    inset = (y) => {
      const share = (y1 - y) / height;
      return 2 * share * (1 - share) * depth;
    };
    if (kind === "xor" || kind === "xnor") {
      sketch.shape(`M-6 ${y0}Q${depth - 6} 0 -6 ${y1}`);
      const bodyInset = inset;
      inset = (y) => bodyInset(y) - 6;
    }
  }
  sketch.nameLabel([width / 2, y0 - 9], "middle", block.name);

  const pins = block.inputs.map((input, index): Pin => {
    const y = (index - (count - 1) / 2) * PIN_PITCH;
    sketch.wire(input.net, [-PIN_LEAD, y], [inset(y), y]);
    return { net: input.net, x: -PIN_LEAD, y, side: "left", needsLabel: true };
  });
  let outX = width;
  if (kind === "inv" || kind === "nand" || kind === "nor" || kind === "xnor") {
    sketch.circle([outX + BUBBLE, 0], BUBBLE);
    outX += 2 * BUBBLE;
  }
  const [output] = block.outputs;
  sketch.wire(output.net, [outX, 0], [outX + PIN_LEAD, 0]);
  return [...pins, { net: output.net, x: outX + PIN_LEAD, y: 0, side: "right", needsLabel: true }];
}

// `feedback` devices join the output to one input; they lie above the body for the inverting
// input and below it for the other, each wired to both leads.
function drawOpamp(block: Block, sketch: Sketch, feedback: Device[]): Pin[] {
  const [width, half] = [56, 30];
  const [output] = block.outputs;
  sketch.stroke(
    [
      [0, -half],
      [0, half],
      [width, 0],
    ],
    { isClosed: true },
  );
  sketch.nameLabel([18, 0], "start", block.name);
  const pins = block.inputs.map((input): Pin => {
    const isInverting = input.key === "n";
    const y = isInverting ? -14 : 14;
    sketch.wire(input.net, [-PIN_LEAD, y], [0, y]);
    sketch.stroke([
      [6, y],
      [12, y],
    ]);
    if (!isInverting) {
      sketch.stroke([
        [9, y - 3],
        [9, y + 3],
      ]);
    }

    const away = isInverting ? -1 : 1;
    const [tapX, returnX] = [-10, width + 10];
    const start = width / 2 - DEVICE_LENGTH / 2;
    let [tapY, returnY] = [y, 0];
    for (const device of feedback.filter((entry) =>
      entry.pins.some((pin) => pin.net === input.net),
    )) {
      const deviceY = tapY === y ? away * (half + 34) : tapY + away * 44;
      const terminals =
        device.pins[0].net === input.net
          ? device.pins
          : ([...device.pins].reverse() as typeof device.pins);
      drawDevice(sketch, device, flat(start, deviceY, isInverting ? 1 : -1), terminals, 0);
      sketch.wire(input.net, [tapX, tapY], [tapX, deviceY], [start, deviceY]);
      sketch.wire(
        output.net,
        [start + DEVICE_LENGTH, deviceY],
        [returnX, deviceY],
        [returnX, returnY],
      );
      sketch.dot(input.net, [tapX, tapY]);
      sketch.dot(output.net, [returnX, returnY]);
      const labelY = deviceY + away * (BODY_HALF[device.kind] + 11);
      if (device.value === null) sketch.nameLabel([width / 2, labelY], "middle", device.name);
      else {
        sketch.nameLabel([width / 2 - 3, labelY], "end", device.name);
        sketch.caption([width / 2 + 3, labelY], "start", device.value, "value");
      }
      [tapY, returnY] = [deviceY, deviceY];
    }
    return { net: input.net, x: -PIN_LEAD, y, side: "left", needsLabel: true };
  });
  sketch.wire(output.net, [width, 0], [width + PIN_LEAD, 0]);
  return [...pins, { net: output.net, x: width + PIN_LEAD, y: 0, side: "right", needsLabel: true }];
}

function drawBox(block: Block, sketch: Sketch): Pin[] {
  const title: Caption = block.title ?? {
    text: BOX_TITLES[block.kind] ?? block.name,
    isTex: false,
  };
  function captionOf(terminal: Terminal, index: number): Caption | null {
    if (block.kind === "block") return null;
    if (block.kind === "mux" && terminal.key === "in") return { text: String(index), isTex: false };
    return PIN_CAPTIONS[terminal.key] ?? null;
  }
  const captionWidth = (terminals: Terminal[]): number =>
    Math.max(
      0,
      ...terminals.map((terminal, index) => {
        const caption = captionOf(terminal, index);
        return caption === null ? 0 : sketch.captionWidth(caption, "name");
      }),
    );
  const rows = Math.max(block.inputs.length, block.outputs.length, 1);
  const width = Math.max(
    44,
    sketch.captionWidth(title, "name") + 16,
    captionWidth(block.inputs) + captionWidth(block.outputs) + 24,
  );
  const titleRoom = 18;
  const height = titleRoom + rows * PIN_PITCH + 6;
  sketch.stroke(
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
    { isClosed: true },
  );
  sketch.caption([width / 2, titleRoom / 2 + 2], "middle", title, "name");
  const hasOwnTitle = block.title !== null || block.kind !== "block";
  if (hasOwnTitle) sketch.nameLabel([width / 2, -9], "middle", block.name);

  function side(terminals: Terminal[], isLeft: boolean): Pin[] {
    return terminals.map((terminal, index): Pin => {
      const y = titleRoom + (index + 0.5 + (rows - terminals.length) / 2) * PIN_PITCH;
      const edge = isLeft ? 0 : width;
      const outer = isLeft ? -PIN_LEAD : width + PIN_LEAD;
      sketch.wire(terminal.net, [outer, y], [edge, y]);
      const caption = captionOf(terminal, index);
      if (terminal.key === "clk") {
        const mark: Point[] = [
          [0, y - 4],
          [7, y],
          [0, y + 4],
        ];
        sketch.stroke(mark);
      } else if (caption !== null) {
        sketch.caption([isLeft ? 6 : width - 6, y], isLeft ? "start" : "end", caption, "name");
      }
      return { net: terminal.net, x: outer, y, side: isLeft ? "left" : "right", needsLabel: true };
    });
  }
  return [...side(block.inputs, true), ...side(block.outputs, false)];
}

// Draws the block into the sketch and returns its pins. `feedback` holds the devices drawn as
// part of an op-amp (see `drawOpamp`); other blocks take none.
function drawBlock(block: Block, sketch: Sketch, feedback: Device[]): Pin[] {
  if (block.kind === "opamp") return drawOpamp(block, sketch, feedback);
  if (
    block.kind === "mux" ||
    block.kind === "dff" ||
    block.kind === "latch" ||
    block.kind === "block"
  ) {
    return drawBox(block, sketch);
  }
  return drawGate(block, sketch);
}

export { drawBlock };
