// Files dropped onto a board from the desktop: each is kept in the vault's
// assets/ folder and placed where it was dropped, in one batch. Pictures
// keep their shape; other files are cards with their name.

import { isImageFile, keepFile } from "../../../../lib/vault/assets";
import { diagramChanged } from "../../../diagrams/store";
import { CARD } from "../model/geometry";
import { dropGrid, type Point } from "../model/placement";
import type { BoardController } from "./controller";
import { projectOf } from "./making";
import { select } from "./store";

/** The longest side of a new picture card, and the shortest a small
 * picture is shown at. */
const PICTURE = 360;
const SMALLEST = 120;

type Shape = { width: number; height: number };

/** A picture's card: its shape, its longer side between 120 and 360 px. */
export function pictureShape(width: number, height: number): Shape | null {
  if (!(width > 0 && height > 0)) return null;
  const longest = Math.max(width, height);
  const scale = Math.min(PICTURE / longest, Math.max(1, SMALLEST / longest));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The shape of a picture file, or null when the window cannot read it. */
async function shapeOf(file: File): Promise<Shape | null> {
  if (!isImageFile(file) || typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const shape = pictureShape(bitmap.width, bitmap.height);
    bitmap.close();
    return shape;
  } catch {
    return null;
  }
}

/** A diagram file from another computer or program. Its picture, a `.drawio.svg`, is an ordinary picture and is kept as one. */
const DIAGRAM_FILE = /\.drawio$/i;

/** Keeps `files` and puts a card for each around `at`, all selected. A
 * diagram (`.drawio`) is brought in as a diagram of the board's project; a
 * file that cannot be kept is left out, saying why. */
export async function addFiles(board: BoardController, files: readonly File[], at: Point, shape: (file: File) => Promise<Shape | null> = shapeOf): Promise<string[]> {
  const kept: { path: string; size: Shape | null }[] = [];
  for (const file of files) {
    try {
      if (DIAGRAM_FILE.test(file.name)) {
        const path = await board.deps.client.importDiagram(file.name, new Uint8Array(await file.arrayBuffer()), projectOf(board.path));
        diagramChanged(path);
        kept.push({ path, size: null });
        continue;
      }
      const [path, size] = await Promise.all([keepFile(board.deps.client, file), shape(file)]);
      kept.push({ path, size });
    } catch (err) {
      board.deps.toast(err instanceof Error ? err.message : String(err));
    }
  }
  if (kept.length === 0) return [];
  // The grid's cells fit the biggest card, so pictures never overlap.
  const cell = kept.reduce<Shape>((most, { size }) => ({ width: Math.max(most.width, size?.width ?? 0), height: Math.max(most.height, size?.height ?? 0) }), { ...CARD });
  const corners = dropGrid(at, kept.length, cell);
  const applied = await board.commit(kept.map(({ path, size }, i) => ({ kind: "card", path, x: corners[i]!.x, y: corners[i]!.y, ...(size ?? {}) })));
  const ids = applied?.made ?? [];
  if (ids.length) select(board.store, ids);
  return ids;
}
