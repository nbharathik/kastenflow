// A rough picture of diagram source for the browser preview, standing in for the
// built-in drawing the app's core makes (kasten-core's diagrams::draw): boxes
// with their words and straight lines between them, on a white ground. It is
// only what the preview needs to show a before and after; the real one knows
// shapes, styles and routes. Null when the source has nothing to draw.

const PAD = 20;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A cell's label as plain words: the HTML a label may hold is taken out. */
function wordsOf(raw: string): string {
  const spaced = raw.replace(/<(br|\/p|\/div)\b[^>]*>/gi, " ");
  return (new DOMParser().parseFromString(spaced, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
}

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/** The first page of `xml` drawn as an SVG; null when it is not plain diagram XML or has no boxes. */
export function draftSvg(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const model = doc.getElementsByTagName("mxGraphModel")[0];
  if (!model) return null;
  const boxes = new Map<string, Box>();
  const arrows: { from: string; to: string }[] = [];
  for (const cell of model.getElementsByTagName("mxCell")) {
    const wrapper = cell.parentElement && /^(object|UserObject)$/.test(cell.parentElement.tagName) ? cell.parentElement : null;
    const id = (wrapper ?? cell).getAttribute("id") ?? "";
    const geometry = cell.getElementsByTagName("mxGeometry")[0];
    if (cell.getAttribute("vertex") === "1" && geometry) {
      const number = (name: string) => Number(geometry.getAttribute(name) ?? 0) || 0;
      boxes.set(id, { id, x: number("x"), y: number("y"), w: number("width") || 80, h: number("height") || 40, label: wordsOf((wrapper ? wrapper.getAttribute("label") : cell.getAttribute("value")) ?? "") });
    } else if (cell.getAttribute("edge") === "1") {
      arrows.push({ from: cell.getAttribute("source") ?? "", to: cell.getAttribute("target") ?? "" });
    }
  }
  if (boxes.size === 0) return null;
  const all = [...boxes.values()];
  const left = Math.min(...all.map((b) => b.x)) - PAD;
  const top = Math.min(...all.map((b) => b.y)) - PAD;
  const width = Math.max(...all.map((b) => b.x + b.w)) + PAD - left;
  const height = Math.max(...all.map((b) => b.y + b.h)) + PAD - top;
  const centre = (b: Box) => `x="${b.x + b.w / 2}" y="${b.y + b.h / 2}"`;
  const lines = arrows.flatMap((a) => {
    const from = boxes.get(a.from);
    const to = boxes.get(a.to);
    return from && to ? [`<line x1="${from.x + from.w / 2}" y1="${from.y + from.h / 2}" x2="${to.x + to.w / 2}" y2="${to.y + to.h / 2}" stroke="#555555" stroke-width="1.5"/>`] : [];
  });
  const shapes = all.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="#ffffff" stroke="#333333" stroke-width="1.5"/><text ${centre(b)} text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="12" fill="#222222">${escape(b.label)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}"><rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#ffffff"/>${lines.join("")}${shapes.join("")}</svg>`;
}
