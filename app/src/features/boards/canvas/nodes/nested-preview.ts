// Small previews of nested boards: the rectangles of what is on them, read
// once and kept until that board's file changes.

import { setCapped } from "../../../../lib/lru";
import type { VaultClient } from "../../../../lib/vault/types";
import { onBoardFiles } from "../../events";
import { bounds, shownRect, type Rect } from "../model/geometry";

export interface Preview {
  title: string;
  /** Every node's rectangle, sections first, and its kind and colour. */
  boxes: (Rect & { kind: string; color?: string })[];
  /** Around all of them, or null for an empty board. */
  frame: Rect | null;
}

const cache = new Map<string, Promise<Preview>>();
/** Previews kept at most; the rest are read again when shown. */
const MOST = 200;
let watching = false;

/** A board's preview, read once. */
export function boardPreview(client: Pick<VaultClient, "board">, path: string): Promise<Preview> {
  if (!watching) {
    watching = true;
    onBoardFiles((paths) => paths.forEach((p) => cache.delete(p)));
  }
  let found = cache.get(path);
  if (!found) {
    found = client.board(path).then((board) => {
      const boxes = [...board.nodes]
        .sort((a, b) => Number(b.kind === "group") - Number(a.kind === "group"))
        .map((n) => ({ ...shownRect(n), kind: n.kind, color: n.color }));
      return { title: board.title, boxes, frame: bounds(boxes) };
    });
    found.catch(() => cache.delete(path));
    setCapped(cache, path, found, MOST);
  }
  return found;
}

/** Forgets a board's preview after it changed (our own writes; the
 * watcher reports everyone else's). */
export function forgetPreview(path: string): void {
  cache.delete(path);
}

/** Forgets every preview (tests). */
export function forgetPreviews(): void {
  cache.clear();
}
