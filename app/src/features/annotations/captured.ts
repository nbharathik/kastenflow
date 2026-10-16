// Which pages can be highlighted: the ones kept from the web, which record
// the address they came from.

import { frontUrl } from "../../lib/url-key";
import type { NoteMeta } from "../../lib/vault/types";

/** Whether a note is a page kept from the web: it names the address it came from, in a `url` key or a `url` property. `prefix` is its frontmatter. */
export function isCaptured(note: Pick<NoteMeta, "kind" | "props">, prefix: string): boolean {
  if (note.kind === "template" || note.kind === "journal") return false;
  const prop = note.props.url;
  return (typeof prop === "string" && prop.trim() !== "") || frontUrl(prefix) !== null;
}
