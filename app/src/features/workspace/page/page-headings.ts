// A page's headings, for `[[Title#` to offer: read once per version of the
// page and kept, so the menu answers each keystroke at once.

import { setCapped } from "../../../lib/lru";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { fenceAfter, type Fence } from "../links";
import { noteAt } from "../tree";
import { useWorkspace } from "../store";

/** The headings in `body`, in order, outside code fences. */
export function headingsOf(body: string): string[] {
  const out: string[] = [];
  let fence: Fence | null = null;
  for (const line of body.split(/\r?\n/)) {
    const [after, marker] = fenceAfter(fence, line);
    fence = after;
    if (marker || fence) continue;
    const found = /^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (found) out.push(found[1]!.trim());
  }
  return out;
}

const cache = new Map<string, { stamp: number; headings: string[] }>();
/** Pages whose headings are kept at most; the rest are read again when asked for. */
const MOST = 500;
const reading = new Set<string>();

/** The page's headings if known, else null, reading them and calling `then`. */
export function pageHeadings(path: string, then: () => void): readonly string[] | null {
  const { notes, client } = useWorkspace.getState();
  const stamp = noteAt(notes, path)?.modified ?? 0;
  const known = cache.get(path);
  if (known && known.stamp === stamp) return known.headings;
  if (!client || reading.has(path)) return null;
  reading.add(path);
  client.read(path).then(
    (file) => {
      reading.delete(path);
      setCapped(cache, path, { stamp, headings: headingsOf(splitFrontmatter(file.text).body) }, MOST);
      then();
    },
    () => {
      reading.delete(path);
      setCapped(cache, path, { stamp, headings: [] }, MOST);
      then();
    },
  );
  return null;
}
