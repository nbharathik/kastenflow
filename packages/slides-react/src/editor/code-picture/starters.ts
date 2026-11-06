// The starting points of Insert → Code picture: small programs for the pictures people ask for most. Each reads
// its data as `inputs.<name>` (CSV text, easy to change in the panel) and draws with the kit and the deck's colours,
// so a copy looks like the deck it lands in. The same seven are kept as files in the starter library of the dev vault.

import type { Program, Template } from "./types.ts";

const data = (name: string, value: string) => ({ name, kind: "data" as const, value });

const program = (code: string, input: ReturnType<typeof data>): Program => ({ language: "js", code, inputs: [input], output: "svg" });

const BAR = `const rows = kit.csv(inputs.sales);
const width = 800, height = 450, m = { top: 30, right: 30, bottom: 60, left: 70 };
const x = kit.scaleBand(rows.map(r => r.month), [m.left, width - m.right]);
const y = kit.scaleLinear([0, Math.max(...rows.map(r => r.total))], [height - m.bottom, m.top]);
const bars = rows.map(r => kit.rect(x(r.month), y(r.total), x.bandwidth(), y(0) - y(r.total), { fill: kit.palette(0), rx: 4 }));
const labels = rows.map(r => kit.text(x.center(r.month), y(r.total) - 8, kit.format(r.total), { anchor: "middle", size: 14 }));
return kit.svg(width, height, [kit.axisLeft(y, m.left), kit.axisBottom(x, height - m.bottom), bars, labels]);`;

const LINE = `const rows = kit.csv(inputs.trend);
const width = 800, height = 450, m = { top: 30, right: 30, bottom: 60, left: 70 };
const x = kit.scaleLinear([rows[0].week, rows[rows.length - 1].week], [m.left, width - m.right]);
const y = kit.scaleLinear([0, Math.max(...rows.map(r => r.visits))], [height - m.bottom, m.top]);
const points = rows.map(r => [x(r.week), y(r.visits)]);
return kit.svg(width, height, [
  kit.axisLeft(y, m.left),
  kit.axisBottom(x, height - m.bottom, { ticks: rows.length }),
  kit.polyline(points, { stroke: kit.palette(0), strokeWidth: 3 }),
  points.map(p => kit.circle(p[0], p[1], 5, { fill: kit.palette(0) })),
]);`;

const TIMELINE = `const rows = kit.csv(inputs.events);
const width = 900, height = 300, pad = 60, mid = 150;
const step = (width - 2 * pad) / Math.max(rows.length - 1, 1);
const parts = [kit.line(pad, mid, width - pad, mid, { stroke: kit.theme.text2, strokeWidth: 3 })];
rows.forEach((r, i) => {
  const x = pad + i * step;
  const up = i % 2 === 0;
  parts.push(kit.circle(x, mid, 10, { fill: kit.palette(i) }));
  parts.push(kit.line(x, mid, x, up ? mid - 40 : mid + 40, { stroke: kit.palette(i), strokeWidth: 2 }));
  parts.push(kit.text(x, up ? mid - 70 : mid + 66, String(r.when), { anchor: "middle", size: 22, weight: 700, fill: kit.palette(i) }));
  parts.push(kit.text(x, up ? mid - 48 : mid + 90, r.what, { anchor: "middle", size: 16 }));
});
return kit.svg(width, height, parts);`;

const MATRIX = `const rows = kit.csv(inputs.items);
const size = 520, pad = 50, mid = size / 2;
const x = kit.scaleLinear([0, 10], [pad, size - pad]);
const y = kit.scaleLinear([0, 10], [size - pad, pad]);
const quad = (qx, qy, label, fill) => [
  kit.rect(qx, qy, mid - pad, mid - pad, { fill: fill, opacity: 0.12 }),
  kit.text(qx + 10, qy + 24, label, { size: 15, weight: 700, fill: kit.theme.text2 }),
];
return kit.svg(size, size, [
  quad(pad, pad, "Quick wins", kit.palette(1)),
  quad(mid, pad, "Big bets", kit.palette(0)),
  quad(pad, mid, "Fill-ins", kit.palette(2)),
  quad(mid, mid, "Skip", kit.palette(3)),
  kit.line(mid, pad, mid, size - pad, { stroke: kit.theme.text2 }),
  kit.line(pad, mid, size - pad, mid, { stroke: kit.theme.text2 }),
  kit.text(mid, size - 12, "Effort", { anchor: "middle", size: 16 }),
  kit.text(16, mid, "Impact", { anchor: "middle", size: 16, transform: "rotate(-90 16 " + mid + ")" }),
  rows.map((r, i) => [
    kit.circle(x(r.effort), y(r.impact), 9, { fill: kit.palette(i) }),
    kit.text(x(r.effort) + 14, y(r.impact) + 5, r.name, { size: 14 }),
  ]),
]);`;

const FUNNEL = `const rows = kit.csv(inputs.stages);
const width = 700, rowH = 70, gap = 8;
const height = rows.length * (rowH + gap) + gap;
const top = rows[0].count;
const parts = rows.map((r, i) => {
  const w = Math.max(width * r.count / top, 120);
  const x = (width - w) / 2, y = gap + i * (rowH + gap);
  return [
    kit.rect(x, y, w, rowH, { fill: kit.palette(i), rx: 6 }),
    kit.text(width / 2, y + rowH / 2 + 7, r.stage + " - " + kit.format(r.count), { anchor: "middle", size: 20, weight: 600, fill: kit.theme.bg1 }),
  ];
});
return kit.svg(width, height, parts);`;

const ORG = `const rows = kit.csv(inputs.people);
const byName = {};
rows.forEach(r => { byName[r.name] = { r: r, kids: [] }; });
let root = null;
rows.forEach(r => {
  const node = byName[r.name];
  if (r.boss && byName[r.boss]) byName[r.boss].kids.push(node);
  else if (!root) root = node;
});
if (!root) throw new Error("Nobody is at the top: leave the boss of one person empty.");
const boxW = 150, boxH = 56, gapX = 24, gapY = 50;
let leaf = 0;
function place(node, depth) {
  node.depth = depth;
  node.kids.forEach(k => place(k, depth + 1));
  node.x = node.kids.length ? (node.kids[0].x + node.kids[node.kids.length - 1].x) / 2 : leaf++ * (boxW + gapX);
}
place(root, 0);
const nodes = Object.keys(byName).map(k => byName[k]).filter(n => n.depth !== undefined);
const deepest = Math.max(...nodes.map(n => n.depth));
const width = Math.max(leaf, 1) * (boxW + gapX) - gapX + 40;
const height = (deepest + 1) * (boxH + gapY) - gapY + 40;
const at = n => ({ x: 20 + n.x, y: 20 + n.depth * (boxH + gapY) });
const parts = [];
nodes.forEach(n => {
  const p = at(n);
  n.kids.forEach(k => {
    const q = at(k);
    parts.push(kit.path("M" + (p.x + boxW / 2) + " " + (p.y + boxH) + "V" + (p.y + boxH + gapY / 2) + "H" + (q.x + boxW / 2) + "V" + q.y, { stroke: kit.theme.text2, strokeWidth: 2 }));
  });
});
nodes.forEach(n => {
  const p = at(n);
  parts.push(kit.rect(p.x, p.y, boxW, boxH, { fill: kit.palette(n.depth), rx: 8 }));
  parts.push(kit.text(p.x + boxW / 2, p.y + 25, n.r.name, { anchor: "middle", size: 17, weight: 700, fill: kit.theme.bg1 }));
  parts.push(kit.text(p.x + boxW / 2, p.y + 45, n.r.role, { anchor: "middle", size: 13, fill: kit.theme.bg1 }));
});
return kit.svg(width, height, parts);`;

const ICONS = `const rows = kit.csv(inputs.items);
const cols = Math.min(rows.length, 3), cell = 220, size = 64, rowH = 180;
const lines = Math.ceil(rows.length / cols);
const width = cols * cell, height = lines * rowH;
const parts = rows.map((r, i) => {
  const cx = (i % cols) * cell + cell / 2, cy = Math.floor(i / cols) * rowH + 20;
  return [
    kit.icon(r.icon, cx - size / 2, cy, size, { stroke: kit.palette(i), strokeWidth: 1.6 }),
    kit.text(cx, cy + size + 30, r.label, { anchor: "middle", size: 20, weight: 600 }),
  ];
});
return kit.svg(width, height, parts);`;

/** The starting points, in the order the chooser lists them. */
export const STARTERS: readonly Template[] = [
  {
    id: "bar-chart",
    label: "Bar chart",
    description: "One bar for each row of a table of numbers",
    program: program(BAR, data("sales", "month,total\nJan,12\nFeb,19\nMar,8\nApr,15\nMay,22\n")),
  },
  {
    id: "line-chart",
    label: "Line chart",
    description: "A line through a number that changes over time",
    program: program(LINE, data("trend", "week,visits\n1,120\n2,150\n3,140\n4,190\n5,230\n6,260\n")),
  },
  {
    id: "timeline",
    label: "Timeline",
    description: "Events along a line, one after another",
    program: program(TIMELINE, data("events", "when,what\n2021,Idea\n2022,Prototype\n2023,Launch\n2024,Growth\n")),
  },
  {
    id: "matrix",
    label: "2x2 matrix",
    description: "Items placed by effort and impact into four squares",
    program: program(MATRIX, data("items", "name,effort,impact\nSearch,3,8\nExport,7,7\nThemes,2,3\nSync,9,4\n")),
  },
  {
    id: "funnel",
    label: "Funnel",
    description: "Stages that narrow, with the count at each",
    program: program(FUNNEL, data("stages", "stage,count\nVisitors,1000\nSign-ups,400\nTrials,150\nCustomers,60\n")),
  },
  {
    id: "org-chart",
    label: "Org chart",
    description: "Who reports to whom",
    program: program(ORG, data("people", "name,role,boss\nAda,CEO,\nBen,CTO,Ada\nCleo,CFO,Ada\nDev,Engineer,Ben\nEli,Engineer,Ben\n")),
  },
  {
    id: "icon-grid",
    label: "Icon grid",
    description: "Icons with a word under each",
    program: program(ICONS, data("items", "icon,label\ncheck,Fast\nheart,Friendly\nbolt,Powerful\ncloud,Anywhere\nstar,Loved\nuser,Yours\n")),
  },
];
