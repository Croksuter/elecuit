// role: shared helpers for the tests of this folder.

const POWER_NAMES = ["VDD", "VCC"];
const GROUND_NAMES = ["GND", "VSS", "VEE"];

// Appends the power and ground declarations a short test netlist leaves out, for the usual supply
// names it connects to. Appending keeps the line numbers of the netlist as written. A netlist
// that declares its supplies itself is returned untouched.
function withRails(text: string): string {
  if (/^\s*(power|ground)\b/m.test(text)) return text;
  const used = (names: string[]): string[] =>
    names.filter((name) => new RegExp(`[=,]${name}(?![A-Za-z0-9_])`).test(text));
  const lines = [
    ...(used(POWER_NAMES).length > 0 ? [`power ${used(POWER_NAMES).join(" ")}`] : []),
    ...(used(GROUND_NAMES).length > 0 ? [`ground ${used(GROUND_NAMES).join(" ")}`] : []),
  ];
  return lines.length === 0 ? text : `${text.replace(/\n$/, "")}\n${lines.join("\n")}\n`;
}

export { withRails };
