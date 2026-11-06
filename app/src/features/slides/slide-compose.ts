// Putting slide pictures together for an agent: every slide as a labelled thumbnail
// (the grid), and one slide before and after side by side with what changed outlined.
// The layouts are plain numbers, tested; drawing them needs a real canvas.

/** A box in pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 12;
const LABEL = 22;
const HEADER = 26;
const THUMB_WIDTH = 320;
const OUTLINE = "#e5484d";

export interface GridLayout {
  columns: number;
  rows: number;
  /** One thumbnail's size in pixels. */
  thumb: { w: number; h: number };
  width: number;
  height: number;
}

/** The grid of `count` slides of `slideW` x `slideH` units, within `maxSide` pixels across. */
export function gridLayout(count: number, slideW: number, slideH: number, maxSide: number): GridLayout {
  const columns = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * (16 / 9)))));
  const rows = Math.max(1, Math.ceil(count / columns));
  const room = Math.floor((maxSide - GAP * (columns + 1)) / columns);
  const w = Math.max(40, Math.min(THUMB_WIDTH, room));
  const h = Math.max(1, Math.round((w * slideH) / slideW));
  return { columns, rows, thumb: { w, h }, width: columns * (w + GAP) + GAP, height: rows * (h + LABEL + GAP) + GAP };
}

/** Where thumbnail `index` goes. */
export function thumbBox(layout: GridLayout, index: number): Box {
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return { x: GAP + column * (layout.thumb.w + GAP), y: GAP + row * (layout.thumb.h + LABEL + GAP), ...layout.thumb };
}

export interface DiffLayout {
  /** Pixels to each unit of the slide, kept within `maxSide`. */
  scale: number;
  width: number;
  height: number;
  before: Box;
  after: Box;
}

/** Two slides of `slideW` x `slideH` units side by side, drawn at `scale` where that fits `maxSide` pixels. */
export function diffLayout(slideW: number, slideH: number, scale: number, maxSide: number): DiffLayout {
  const fit = Math.min(scale, (maxSide - 3 * GAP) / (2 * slideW), (maxSide - HEADER - 2 * GAP) / slideH);
  const w = Math.max(1, Math.round(slideW * fit));
  const h = Math.max(1, Math.round(slideH * fit));
  const top = HEADER + GAP;
  return {
    scale: fit,
    width: 2 * w + 3 * GAP,
    height: top + h + GAP,
    before: { x: GAP, y: top, w, h },
    after: { x: 2 * GAP + w, y: top, w, h },
  };
}

/** A mark (x, y, w, h in slide units) as a box on a picture of the slide at `box`, a little larger so it does not hide the edge. */
export function markBox(mark: number[], box: Box, slideW: number): Box {
  const k = box.w / slideW;
  const [x = 0, y = 0, w = 0, h = 0] = mark;
  return { x: box.x + x * k - 2, y: box.y + y * k - 2, w: w * k + 4, h: h * k + 4 };
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This window cannot make a picture");
  context.fillStyle = "#f4f4f5";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

async function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This window could not turn the picture into a PNG");
  return new Uint8Array(await blob.arrayBuffer());
}

const bitmap = (bytes: Uint8Array): Promise<ImageBitmap> => createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));

/** The thumbnails (PNG bytes, in slide order) in one picture, each labelled with its number. */
export async function composeGrid(thumbs: Uint8Array[], layout: GridLayout): Promise<Uint8Array> {
  const { canvas, context } = canvasOf(layout.width, layout.height);
  context.font = "13px sans-serif";
  context.textBaseline = "top";
  for (const [index, bytes] of thumbs.entries()) {
    const box = thumbBox(layout, index);
    const picture = await bitmap(bytes);
    context.drawImage(picture, box.x, box.y, box.w, box.h);
    picture.close();
    context.strokeStyle = "#a1a1aa";
    context.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    context.fillStyle = "#27272a";
    context.fillText(String(index + 1), box.x, box.y + box.h + 4);
  }
  return pngBytes(canvas);
}

/** Two slide pictures side by side, headed Before and After, with the changed boxes outlined on each. */
export async function composeDiff(
  pictures: { before: Uint8Array; after: Uint8Array },
  layout: DiffLayout,
  slideW: number,
  marks: { before: number[][]; after: number[][] },
): Promise<Uint8Array> {
  const { canvas, context } = canvasOf(layout.width, layout.height);
  context.font = "bold 14px sans-serif";
  context.textBaseline = "top";
  for (const side of ["before", "after"] as const) {
    const box = layout[side];
    const picture = await bitmap(pictures[side]);
    context.drawImage(picture, box.x, box.y, box.w, box.h);
    picture.close();
    context.fillStyle = "#27272a";
    context.fillText(side === "before" ? "Before" : "After", box.x, 6);
    context.strokeStyle = OUTLINE;
    context.lineWidth = 3;
    for (const mark of marks[side]) {
      const m = markBox(mark, box, slideW);
      context.strokeRect(m.x, m.y, m.w, m.h);
    }
  }
  return pngBytes(canvas);
}
