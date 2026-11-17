// role: chooses how many schematics of a group sit side by side and the one scale they share.

interface Arrangement {
  // One scale for the whole group, so the same device is the same size in every schematic.
  scale: number;
  // Scaled width of each column; its length is the number of schematics per row.
  columnWidths: number[];
}

const MAX_SCALE = 1.25;
// Below this, net labels get too small to read; the group then takes fewer columns instead.
const MIN_SHARED_SCALE = 0.7;

// `widths` are the unscaled widths in reading order, `available` the width of the row and `gap`
// the space between columns. A group left with one column shrinks as far as the row needs.
function arrange(widths: number[], available: number, gap: number): Arrangement {
  if (widths.length === 0) throw new Error("arrange: a group holds at least one schematic");
  if (widths.some((width) => !(width > 0))) throw new Error("arrange: widths must be positive");

  function columnMaxima(columns: number): number[] {
    return Array.from({ length: columns }, (_, column) =>
      Math.max(...widths.filter((_, index) => index % columns === column)),
    );
  }

  function fitScale(columns: number): number {
    const total = columnMaxima(columns).reduce((sum, width) => sum + width, 0);
    return Math.max(0, available - gap * (columns - 1)) / total;
  }

  let columns = widths.length;
  while (columns > 1 && fitScale(columns) < MIN_SHARED_SCALE) columns -= 1;
  const scale = Math.min(MAX_SCALE, fitScale(columns));
  return { scale, columnWidths: columnMaxima(columns).map((width) => width * scale) };
}

export { arrange };
