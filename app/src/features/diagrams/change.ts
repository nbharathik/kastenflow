// A diagram's change in the history, as what changed to what. The file is
// draw.io's XML; a line diff of it says little, so the cells are read: how many
// shapes and connectors there were and are, which were added or removed, which
// got a new label, which moved or changed their look. Only a diagram saved as
// plain XML can be read this way (KastenFlow writes it so); a compressed one
// is said to be unreadable, and its raw text stays available.

export interface DiagramChange {
  /** Whether the cells could be read on both sides. */
  readable: boolean;
  /** Made, removed, or changed. */
  kind: "made" | "removed" | "changed";
  /** [before, after] */
  shapes: [number, number];
  connectors: [number, number];
  pages: [number, number];
  /** Labels (or "a shape", "a connector" when a cell has none). */
  added: string[];
  removed: string[];
  renamed: [from: string, to: string][];
  moved: number;
  restyled: number;
}

interface Cell {
  kind: "shape" | "connector";
  label: string;
  geometry: string;
  style: string;
}

interface Parsed {
  cells: Map<string, Cell>;
  pages: number;
}

const LONGEST = 40;
const SHAPE = "a shape";
const CONNECTOR = "a connector";

/** A cell's label as words: its HTML taken out, short enough for a sentence. */
function words(raw: string): string {
  const spaced = raw.replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, " ");
  const text = (new DOMParser().parseFromString(spaced, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > LONGEST ? `${text.slice(0, LONGEST)}…` : text;
}

/** The cells of a diagram file, by page and id; null when it is not plain XML with cells. */
function parse(text: string): Parsed | null {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const pages = [...doc.getElementsByTagName("diagram")];
  const cells = new Map<string, Cell>();
  for (const [at, page] of pages.entries()) {
    // A compressed page is text, with no model inside.
    if (page.getElementsByTagName("mxGraphModel").length === 0) return null;
    for (const cell of page.getElementsByTagName("mxCell")) {
      const kind = cell.getAttribute("vertex") === "1" ? "shape" : cell.getAttribute("edge") === "1" ? "connector" : null;
      if (!kind) continue;
      // A cell inside an <object> has its id and label on the wrapper.
      const wrapper = cell.parentElement && /^(object|UserObject)$/.test(cell.parentElement.tagName) ? cell.parentElement : null;
      const id = (wrapper ?? cell).getAttribute("id");
      if (!id) continue;
      const geometry = cell.getElementsByTagName("mxGeometry")[0];
      cells.set(`${at}:${id}`, {
        kind,
        label: words((wrapper ? wrapper.getAttribute("label") : cell.getAttribute("value")) ?? ""),
        geometry: ["x", "y", "width", "height"].map((a) => geometry?.getAttribute(a) ?? "").join(","),
        style: cell.getAttribute("style") ?? "",
      });
    }
  }
  return { cells, pages: pages.length };
}

const countOf = (cells: Map<string, Cell>, kind: Cell["kind"]) => [...cells.values()].filter((c) => c.kind === kind).length;
const nameOf = (cell: Cell) => cell.label || (cell.kind === "shape" ? SHAPE : CONNECTOR);

/** What changed between two versions of a diagram file; either may be null (not there). */
export function diagramChange(before: string | null, after: string | null): DiagramChange {
  const kind = before === null ? "made" : after === null ? "removed" : "changed";
  const a = before === null ? { cells: new Map<string, Cell>(), pages: 0 } : parse(before);
  const b = after === null ? { cells: new Map<string, Cell>(), pages: 0 } : parse(after);
  const none: DiagramChange = { readable: false, kind, shapes: [0, 0], connectors: [0, 0], pages: [0, 0], added: [], removed: [], renamed: [], moved: 0, restyled: 0 };
  if (!a || !b) return none;
  const change: DiagramChange = { ...none, readable: true, shapes: [countOf(a.cells, "shape"), countOf(b.cells, "shape")], connectors: [countOf(a.cells, "connector"), countOf(b.cells, "connector")], pages: [a.pages, b.pages] };
  // Shapes before connectors, each in the order they are drawn.
  const ordered = (cells: Map<string, Cell>, keys: string[]) => [...keys].sort((x, y) => Number(cells.get(x)!.kind === "connector") - Number(cells.get(y)!.kind === "connector"));
  change.added = ordered(b.cells, [...b.cells.keys()].filter((k) => !a.cells.has(k))).map((k) => nameOf(b.cells.get(k)!));
  change.removed = ordered(a.cells, [...a.cells.keys()].filter((k) => !b.cells.has(k))).map((k) => nameOf(a.cells.get(k)!));
  for (const [key, was] of a.cells) {
    const now = b.cells.get(key);
    if (!now) continue;
    if (was.label !== now.label) change.renamed.push([nameOf(was), nameOf(now)]);
    if (was.geometry !== now.geometry) change.moved += 1;
    if (was.style !== now.style) change.restyled += 1;
  }
  return change;
}

const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;
const quoted = (name: string) => (name === SHAPE || name === CONNECTOR ? name : `“${name}”`);

/** “A”, “B” and “C”; more than three end in "and N more". Unlabelled cells are counted: "2 connectors". */
function listOf(names: string[]): string {
  const labelled = names.filter((n) => n !== SHAPE && n !== CONNECTOR).map(quoted);
  const shapes = names.filter((n) => n === SHAPE).length;
  const connectors = names.filter((n) => n === CONNECTOR).length;
  const items = [...labelled, ...(shapes ? [shapes === 1 ? SHAPE : `${shapes} shapes`] : []), ...(connectors ? [connectors === 1 ? CONNECTOR : `${connectors} connectors`] : [])];
  const shown = items.slice(0, 3);
  const rest = items.length - shown.length;
  const all = rest > 0 ? [...shown, `${rest} more`] : shown;
  return all.length <= 1 ? (all[0] ?? "") : `${all.slice(0, -1).join(", ")} and ${all.at(-1)}`;
}

/** The change as sentences, most useful first. */
export function diagramChangeWords(change: DiagramChange): string[] {
  if (!change.readable) return ["The diagram's shapes could not be read to say what changed."];
  const [shapesBefore, shapesAfter] = change.shapes;
  const [connectorsBefore, connectorsAfter] = change.connectors;
  if (change.kind === "made") return [`A new diagram with ${plural(shapesAfter, "shape", "shapes")} and ${plural(connectorsAfter, "connector", "connectors")}.`];
  if (change.kind === "removed") return [`The diagram was removed. It had ${plural(shapesBefore, "shape", "shapes")} and ${connectorsBefore === 0 ? "no connectors" : plural(connectorsBefore, "connector", "connectors")}.`];
  const lines: string[] = [];
  if (shapesBefore !== shapesAfter) lines.push(`Shapes: ${shapesBefore} → ${shapesAfter}.`);
  if (connectorsBefore !== connectorsAfter) lines.push(`Connectors: ${connectorsBefore} → ${connectorsAfter}.`);
  if (change.pages[0] !== change.pages[1]) lines.push(`Pages: ${change.pages[0]} → ${change.pages[1]}.`);
  if (change.added.length > 0) lines.push(`Added ${listOf(change.added)}.`);
  if (change.removed.length > 0) lines.push(`Removed ${listOf(change.removed)}.`);
  if (change.renamed.length > 0) lines.push(`Renamed ${change.renamed.slice(0, 3).map(([from, to]) => `${quoted(from)} → ${quoted(to)}`).join(", ")}${change.renamed.length > 3 ? ` and ${change.renamed.length - 3} more` : ""}.`);
  if (change.moved > 0) lines.push(`Moved or resized ${plural(change.moved, "shape", "shapes")}.`);
  if (change.restyled > 0) lines.push(`Changed the look of ${plural(change.restyled, "shape", "shapes")}.`);
  return lines.length > 0 ? lines : ["No shape, connector or label changed."];
}
