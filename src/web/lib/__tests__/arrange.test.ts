// role: checks how many schematics a group puts in a row and the scale they share.
// cell: T1/unit

import { describe, expect, it } from "vitest";

import { arrange } from "../arrange";

describe("arrange", () => {
  it("puts two schematics side by side at one scale when the row is wide enough", () => {
    const { scale, columnWidths } = arrange([400, 500], 920, 20);
    expect(scale).toBe(1);
    expect(columnWidths).toEqual([400, 500]);
  });

  it("never enlarges past the largest scale", () => {
    expect(arrange([200], 1000, 20)).toEqual({ scale: 1.25, columnWidths: [250] });
  });

  it("takes fewer columns instead of shrinking below the readable scale", () => {
    // Side by side would need (600 - 20) / 900 ≈ 0.64, so the two stack and fit the wider one.
    const stacked = arrange([400, 500], 600, 20);
    expect(stacked.columnWidths).toHaveLength(1);
    expect(stacked.scale).toBe(1.2);
    // Four in a row would need 0.52 and three 0.69; two columns, each as wide as its wider
    // member (400 and 600), need 0.98.
    const grid = arrange([400, 500, 300, 600], 1000, 20);
    expect(grid.columnWidths).toHaveLength(2);
    expect(grid.scale).toBeCloseTo(0.98);
    expect(grid.columnWidths[0] + grid.columnWidths[1] + 20).toBeCloseTo(1000);
  });

  it("shrinks a lone schematic to fit, but not below the scale it stays readable at", () => {
    expect(arrange([800], 600, 20).scale).toBe(0.75);
    expect(arrange([2600], 700, 20).scale).toBe(0.6);
  });

  it("refuses an empty group and a width that is not positive", () => {
    expect(() => arrange([], 400, 20)).toThrow();
    expect(() => arrange([400, 0], 400, 20)).toThrow();
  });
});
