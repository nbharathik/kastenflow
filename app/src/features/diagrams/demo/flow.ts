// The diagram the demo opens: how a note is kept and backed up, drawn as a few
// boxes and arrows. One list of boxes makes both the diagram's source and its
// stored picture, so the two always agree.

export const FLOW_TITLE = "Backup flow";

interface Box {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface Arrow {
  from: string;
  to: string;
  label: string;
}

const W = 170;
const H = 60;

const BOXES: Box[] = [
  { id: "write", label: "Write a note", x: 30, y: 60 },
  { id: "history", label: "Saved in history", x: 260, y: 60 },
  { id: "repo", label: "Private GitHub repo", x: 490, y: 60 },
  { id: "other", label: "Second computer", x: 720, y: 60 },
  { id: "undo", label: "Undo anything", x: 260, y: 200 },
];

const ARROWS: Arrow[] = [
  { from: "write", to: "history", label: "kept" },
  { from: "history", to: "repo", label: "backed up" },
  { from: "repo", to: "other", label: "get latest" },
  { from: "history", to: "undo", label: "restore" },
];

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The diagram as the editor keeps it: plain XML, one page. */
export const FLOW_XML = [
  '<mxfile host="kastenflow"><diagram id="flow" name="Page-1"><mxGraphModel><root>',
  '<mxCell id="0"/><mxCell id="1" parent="0"/>',
  ...BOXES.map((b) => `<mxCell id="${b.id}" value="${escape(b.label)}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="${b.x}" y="${b.y}" width="${W}" height="${H}" as="geometry"/></mxCell>`),
  ...ARROWS.map((a, i) => `<mxCell id="e${i}" value="${escape(a.label)}" style="endArrow=classic;html=1;" edge="1" parent="1" source="${a.from}" target="${a.to}"><mxGeometry relative="1" as="geometry"/></mxCell>`),
  "</root></mxGraphModel></diagram></mxfile>",
].join("");

/** Where the line from one box's middle to another's leaves the first box. */
function edgePoint(from: Box, to: Box): [number, number] {
  const cx = from.x + W / 2;
  const cy = from.y + H / 2;
  const dx = to.x + W / 2 - cx;
  const dy = to.y + H / 2 - cy;
  const scale = Math.min(dx === 0 ? Infinity : W / 2 / Math.abs(dx), dy === 0 ? Infinity : H / 2 / Math.abs(dy));
  return [cx + dx * scale, cy + dy * scale];
}

/** The picture kept beside the diagram: white ground, boxes, arrows with their words. */
export function flowSvg(): string {
  const byId = new Map(BOXES.map((b) => [b.id, b]));
  const arrows = ARROWS.map((a) => {
    const from = byId.get(a.from)!;
    const to = byId.get(a.to)!;
    const [x1, y1] = edgePoint(from, to);
    const [x2, y2] = edgePoint(to, from);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const tip = (turn: number) => `${(x2 - 10 * Math.cos(angle + turn)).toFixed(1)},${(y2 - 10 * Math.sin(angle + turn)).toFixed(1)}`;
    const label = `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${((y1 + y2) / 2 - 8).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#555555">${escape(a.label)}</text>`;
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#444444" stroke-width="1.6"/><polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${tip(0.4)} ${tip(-0.4)}" fill="#444444"/>${label}`;
  });
  const boxes = BOXES.map(
    (b) =>
      `<rect x="${b.x}" y="${b.y}" width="${W}" height="${H}" rx="10" fill="#ffffff" stroke="#333333" stroke-width="1.6"/><text x="${b.x + W / 2}" y="${b.y + H / 2}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="15" fill="#1d1d1b">${escape(b.label)}</text>`,
  );
  const right = Math.max(...BOXES.map((b) => b.x + W)) + 30;
  const bottom = Math.max(...BOXES.map((b) => b.y + H)) + 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${right}" height="${bottom}" viewBox="0 0 ${right} ${bottom}"><rect width="${right}" height="${bottom}" fill="#ffffff"/>${arrows.join("")}${boxes.join("")}</svg>`;
}
