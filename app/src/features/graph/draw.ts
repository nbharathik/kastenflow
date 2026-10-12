// Drawing the graph on a 2D canvas: links under, nodes over, names beside the
// nodes that matter at this zoom. Everything comes in through one object so
// the drawing has no state of its own and can be checked against a recording
// context.

import type { Camera } from "./camera";
import { css, mix, type Ink, type Palette } from "./colours";
import { colourOf, labelThreshold, radiusOf, type ColourBy, type Model } from "./graph-model";
import { placeLabels, type Candidate } from "./labels";

export interface DrawState {
  /** The canvas in CSS pixels, and the device's pixel ratio. */
  width: number;
  height: number;
  ratio: number;
  cam: Camera;
  model: Model;
  /** x, y pairs, one for each node; empty until the layout has reported. */
  places: Float32Array | null;
  palette: Palette;
  /** The font for names: its size in pixels and its family. */
  font: { size: number; family: string };
  colourBy: ColourBy;
  /** The node under the pointer, and it with its neighbours. */
  hover: number;
  lit: ReadonlySet<number> | null;
  selected: number;
  /** A link being dragged out of a node: where the pointer is on the canvas and the node it is over, or -1. */
  link: { from: number; x: number; y: number; over: number } | null;
  /** Names every node that has room, whatever the zoom: a small graph. */
  nameAll: boolean;
}

export interface Tools {
  path(): Path2D;
  measure(text: string): number;
}

/** A node's radius on the canvas: it grows with the zoom, but slower than the layout does. */
export const screenRadius = (links: number, zoom: number): number => Math.max(2.2, Math.min(24, radiusOf(links) * Math.sqrt(zoom)));

const defaults = (ctx: CanvasRenderingContext2D): Tools => ({ path: () => new Path2D(), measure: (text) => ctx.measureText(text).width });

export function drawGraph(ctx: CanvasRenderingContext2D, s: DrawState, tools: Tools = defaults(ctx)): void {
  const { width, height, ratio, cam, model, places, palette } = s;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!places || model.nodes.length === 0) return;
  const count = model.nodes.length;
  const px = (i: number) => places[2 * i]! * cam.k + cam.x;
  const py = (i: number) => places[2 * i + 1]! * cam.k + cam.y;
  const inView = (x: number, y: number, pad: number) => x > -pad && x < width + pad && y > -pad && y < height + pad;
  const dim = s.lit !== null;
  const ink = palette.ink;

  // Links: one path for each look, so a big graph is a few strokes.
  const normal = tools.path();
  const embedded = tools.path();
  const guessed = tools.path();
  const boards = tools.path();
  const touching = tools.path();
  for (const edge of model.edges) {
    const [x0, y0, x1, y1] = [px(edge.from), py(edge.from), px(edge.to), py(edge.to)];
    const lit = s.lit && (edge.from === s.hover || edge.to === s.hover);
    if (!lit && (Math.max(x0, x1) < 0 || Math.min(x0, x1) > width || Math.max(y0, y1) < 0 || Math.min(y0, y1) > height)) continue;
    const path = lit ? touching : edge.ambiguous ? guessed : edge.embed ? embedded : edge.board ? boards : normal;
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
  }
  const faint = (t: number) => css(mix(palette.canvas, ink, t));
  ctx.lineWidth = 1;
  ctx.strokeStyle = faint(dim ? 0.1 : count > 3000 ? 0.16 : 0.26);
  ctx.setLineDash([]);
  ctx.stroke(normal);
  ctx.strokeStyle = faint(dim ? 0.08 : 0.2);
  ctx.setLineDash([2, 3]);
  ctx.stroke(embedded);
  ctx.strokeStyle = css(mix(palette.canvas, palette.accent, dim ? 0.25 : 0.55));
  ctx.setLineDash([5, 3]);
  ctx.stroke(guessed);
  ctx.strokeStyle = css(mix(palette.canvas, palette.muted, dim ? 0.15 : 0.4));
  ctx.setLineDash([]);
  ctx.stroke(boards);
  ctx.setLineDash([]);
  if (s.lit) {
    ctx.strokeStyle = css(palette.accent);
    ctx.lineWidth = 1.6;
    ctx.stroke(touching);
    ctx.lineWidth = 1;
  }

  // Nodes: a path for each colour, and the hollow ones for pages that do not exist yet.
  const byColour = new Map<string, Path2D>();
  const dimmed = new Map<string, Path2D>();
  const hollow = tools.path();
  const outline = tools.path();
  const radii = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const node = model.nodes[i]!;
    const [x, y] = [px(i), py(i)];
    const r = (radii[i] = screenRadius(node.links, cam.k));
    if (!inView(x, y, r + 4)) continue;
    if (node.kind === "ghost") {
      hollow.moveTo(x + r, y);
      hollow.arc(x, y, r, 0, Math.PI * 2);
      continue;
    }
    const name = colourOf(node, s.colourBy);
    const faded = (s.lit && !s.lit.has(i)) || node.outside;
    const into = faded ? dimmed : byColour;
    let path = into.get(name);
    if (!path) into.set(name, (path = tools.path()));
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, Math.PI * 2);
    if (!faded) {
      outline.moveTo(x + r, y);
      outline.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  const fill = (name: string): Ink => {
    // The kind's colour, deepened toward the ink so a dot shows on the page in either theme.
    const base = palette.highlight[name] ?? palette.highlight.gray!;
    return mix(base, ink, 0.28);
  };
  ctx.globalAlpha = s.lit ? 0.3 : 0.55;
  for (const [name, path] of dimmed) {
    ctx.fillStyle = css(fill(name));
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;
  for (const [name, path] of byColour) {
    ctx.fillStyle = css(fill(name));
    ctx.fill(path);
  }
  ctx.strokeStyle = css(ink, 0.4);
  ctx.lineWidth = 1;
  ctx.stroke(outline);
  ctx.fillStyle = css(palette.canvas);
  ctx.fill(hollow);
  ctx.strokeStyle = css(palette.muted, 0.8);
  ctx.setLineDash([2, 2]);
  ctx.stroke(hollow);
  ctx.setLineDash([]);

  ring(ctx, s, s.selected, px, py, radii, css(palette.accent), 2, 4);
  if (s.hover !== s.selected) ring(ctx, s, s.hover, px, py, radii, css(ink, 0.7), 1.5, 3);
  if (s.link) {
    ctx.strokeStyle = css(palette.accent);
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px(s.link.from), py(s.link.from));
    ctx.lineTo(s.link.x, s.link.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ring(ctx, s, s.link.over, px, py, radii, css(palette.accent), 1.5, 3);
  }

  // Names.
  const threshold = labelThreshold(cam.k, count);
  const wanted: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    const node = model.nodes[i]!;
    const force = i === s.hover || i === s.selected || (s.lit?.has(i) ?? false);
    if (!force && !(s.nameAll || node.links >= threshold)) continue;
    const [x, y] = [px(i), py(i)];
    if (!inView(x, y, 40)) continue;
    wanted.push({ index: i, x, y, r: radii[i]!, text: shorten(node.title), priority: node.links + (node.kind === "ghost" ? 0 : 0.5), force });
  }
  if (wanted.length === 0) return;
  ctx.font = `${s.font.size}px ${s.font.family}`;
  ctx.textBaseline = "alphabetic";
  const widths = new Map<string, number>();
  const measure = (text: string) => {
    let w = widths.get(text);
    if (w === undefined) widths.set(text, (w = tools.measure(text)));
    return w;
  };
  const shown = placeLabels(wanted, width, height, measure);
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = css(palette.canvas, 0.9);
  for (const name of shown) {
    const node = model.nodes[name.index]!;
    const faded = s.lit !== null && !s.lit.has(name.index);
    ctx.fillStyle = css(node.kind === "ghost" ? palette.muted : ink, faded ? 0.5 : 1);
    // A halo of the page's colour keeps a name legible over links.
    ctx.strokeText(name.text, name.x, name.y);
    ctx.fillText(name.text, name.x, name.y);
  }
}

/** A title short enough to sit beside a node. */
export const shorten = (title: string, most = 34): string => (title.length > most ? `${title.slice(0, most - 1).trimEnd()}…` : title);

/** A ring round node `i`, if there is one. */
function ring(ctx: CanvasRenderingContext2D, s: DrawState, i: number, px: (i: number) => number, py: (i: number) => number, radii: Float64Array, colour: string, width: number, gap: number): void {
  if (i < 0 || i >= s.model.nodes.length) return;
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(px(i), py(i), (radii[i] ?? 4) + gap, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
}
