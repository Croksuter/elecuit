// role: turns a circuit into a drawing: device clusters and blocks become modules, then get placed.

import { drawBlock } from "./blocks";
import { boundsOf, shift, Sketch } from "./drawing";
import type { Drawing, Measure } from "./drawing";
import type { Block, Circuit, Device, Rails } from "./netlist";
import { layoutNetwork } from "./network";
import { place } from "./place";
import type { Module } from "./place";

const MARGIN = 16;

// Groups devices whose pins share a node other than a rail; control terminals do not join groups.
function findClusters(devices: Device[], rails: Rails): Device[][] {
  const parent = new Map<string, string>();
  function find(key: string): string {
    if (!parent.has(key)) parent.set(key, key);
    while (parent.get(key) !== key) key = parent.get(key)!;
    return key;
  }
  function keyOf(device: Device): string {
    const node = device.pins.find((pin) => !rails.has(pin.net));
    return node ? `net:${node.net}` : `device:${device.name}`;
  }
  for (const device of devices) {
    for (const pin of device.pins) {
      if (!rails.has(pin.net)) parent.set(find(`net:${pin.net}`), find(keyOf(device)));
    }
  }
  const clusters = new Map<string, Device[]>();
  for (const device of devices) {
    const root = find(keyOf(device));
    clusters.set(root, [...(clusters.get(root) ?? []), device]);
  }
  return [...clusters.values()];
}

function layout(circuit: Circuit, measure: Measure): Drawing {
  const { rails } = circuit;
  const createSketch = (): Sketch => new Sketch(circuit.labels, rails, measure);
  const blocks = circuit.elements.filter((element) => element.type === "block");
  // A two-terminal device from an op-amp's output back to one of its inputs is drawn with the
  // op-amp, around its body, instead of in a cluster.
  const feedback = new Map<Device, Block>();
  for (const element of circuit.elements) {
    if (element.type !== "device" || element.control !== null) continue;
    const nets = element.pins.map((pin) => pin.net);
    const owner = blocks.find(
      (block) =>
        block.kind === "opamp" &&
        nets[0] !== nets[1] &&
        nets.includes(block.outputs[0].net) &&
        block.inputs.some((input) => !rails.has(input.net) && nets.includes(input.net)),
    );
    if (owner) feedback.set(element, owner);
  }
  const devices = circuit.elements.filter(
    (element): element is Device => element.type === "device" && !feedback.has(element),
  );
  const blockOutputs = new Set(
    blocks.flatMap((block) => block.outputs.map((output) => output.net)),
  );

  const modules: Module[] = [];
  for (const cluster of findClusters(devices, rails)) {
    const sketch = createSketch();
    const pins = layoutNetwork(cluster, sketch);
    const nodes = [
      ...new Set(
        cluster
          .flatMap((device) => device.pins.map((pin) => pin.net))
          .filter((net) => !rails.has(net)),
      ),
    ];
    const controls = cluster.flatMap((device) =>
      device.control === null ? [] : [device.control.net],
    );
    modules.push({
      primitives: sketch.primitives,
      pins,
      drives: nodes,
      // A node a block drives is an input of the cluster, so the cluster sits after that block.
      consumes: [...new Set([...controls, ...nodes.filter((net) => blockOutputs.has(net))])],
      line: Math.min(...cluster.map((device) => device.line)),
    });
  }
  for (const block of blocks) {
    const sketch = createSketch();
    modules.push({
      primitives: sketch.primitives,
      pins: drawBlock(
        block,
        sketch,
        [...feedback].filter(([, owner]) => owner === block).map(([device]) => device),
      ),
      drives: block.outputs.map((output) => output.net),
      consumes: block.inputs.map((input) => input.net),
      line: block.line,
    });
  }
  if (modules.length === 0) return { primitives: [], width: 0, height: 0, notes: [] };

  const primitives = place(modules, createSketch);
  const bounds = boundsOf(primitives);
  return {
    primitives: primitives.map((primitive) =>
      shift(primitive, MARGIN - bounds.x0, MARGIN - bounds.y0),
    ),
    width: bounds.x1 - bounds.x0 + 2 * MARGIN,
    height: bounds.y1 - bounds.y0 + 2 * MARGIN,
    notes: [],
  };
}

export { layout };
