// Find and replace across a page and its sub-pages in the browser preview,
// with the core's guardrails (engine/replace.rs): a preview that writes
// nothing, then a replace that changes every listed page or none, if each
// is still as the preview saw it.

import { REPLACE_LIMITS } from "../../../lib/vault/replace-types";
import type { FindSpec, NoteFile, NoteMatches, NoteMeta, ReplaceRequest } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { checkSpec, checkWith, findInBody, replaceInBody, samplesOf, titleMatches } from "./replace-text";

const SAMPLES = 3;
const STALE = "Some pages changed since the preview, so nothing was replaced. Look again.";

/** A page to write: its new text and how many matches it held. */
export interface Edit {
  path: string;
  text: string;
  count: number;
}

/** The page `root` (an id or a path) and every page below it through `parent`: the page, then the others by path; templates aside. */
export function scopeOf(notes: readonly NoteMeta[], root: string): string[] {
  const start = notes.find((n) => n.id === root || n.path === root || n.path === `${root}.md`);
  if (!start) throw new Error(`No page “${root}” to look under`);
  const seen = new Set([start.path]);
  const queue = [start];
  for (let at = queue.shift(); at; at = queue.shift()) {
    for (const note of notes) {
      if (at.id && note.parent === at.id && !seen.has(note.path)) {
        seen.add(note.path);
        queue.push(note);
      }
    }
  }
  const below = [...seen].filter((path) => path !== start.path).sort();
  return [start.path, ...below].filter((path) => !/^templates\//i.test(path));
}

/** Whether `path` is a plain note path: forward slashes, no `.` or `..`, no private first folder, ends in `.md`. */
function isNotePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || /[\\:\0]/.test(path) || !path.endsWith(".md")) return false;
  const parts = path.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..") && !parts[0]!.startsWith(".") && parts[0] !== "node_modules";
}

/** The pages under `root` whose text or title holds the search text, with hash and count each. */
export function findUnderIn(notes: readonly NoteMeta[], read: (path: string) => NoteFile, root: string, spec: FindSpec, maxNotes: number): NoteMatches[] {
  checkSpec(spec);
  const out: NoteMatches[] = [];
  for (const path of scopeOf(notes, root)) {
    if (out.length >= maxNotes) break;
    const note = read(path);
    const body = splitFrontmatter(note.text).body;
    const found = findInBody(body, spec);
    const titleHit = titleMatches(note.meta.title, spec);
    if (found.length === 0 && !titleHit) continue;
    out.push({ path, title: note.meta.title, hash: note.hash, count: found.length, samples: samplesOf(body, found, SAMPLES), titleHit, locked: note.meta.locked });
  }
  return out;
}

/** Everything a replace would write, or why it is refused: nothing is written here. */
export function planReplace(notes: readonly NoteMeta[], read: (path: string) => NoteFile, request: ReplaceRequest): Edit[] {
  checkSpec(request.spec);
  checkWith(request.with);
  const { expect } = request;
  if (expect.length === 0) throw new Error("Nothing to replace: look first, then replace what was found");
  if (expect.length > REPLACE_LIMITS.notes) throw new Error(`At most ${REPLACE_LIMITS.notes} pages can be replaced in at once`);
  if (expect.reduce((sum, e) => sum + e.count, 0) > REPLACE_LIMITS.replacements) throw new Error("At most 5,000 replacements can be made at once");
  const listed = new Set<string>();
  for (const { path } of expect) {
    if (listed.has(path)) throw new Error(`${path} is listed twice`);
    listed.add(path);
  }
  const scope = new Set(scopeOf(notes, request.root));
  const edits: Edit[] = [];
  for (const expected of expect) {
    if (!isNotePath(expected.path)) throw new Error(`Not a note path in this vault: ${expected.path}`);
    if (!scope.has(expected.path)) throw new Error(`${expected.path} is not under that page, so it is not replaced`);
    let note: NoteFile;
    try {
      note = read(expected.path);
    } catch {
      throw new Error(STALE);
    }
    if (note.hash !== expected.hash) throw new Error(STALE);
    if (note.meta.locked) throw new Error(`“${note.meta.title}” is locked, so nothing was replaced. Unlock it, or leave it out`);
    const parts = splitFrontmatter(note.text);
    const { text, count } = replaceInBody(parts.body, request.spec, request.with);
    if (count !== expected.count) throw new Error(STALE);
    const next = parts.prefix + text;
    if (splitFrontmatter(next).prefix !== parts.prefix) throw new Error(`That would change the frontmatter of ${expected.path}, so nothing was replaced`);
    if (next !== note.text) edits.push({ path: expected.path, text: next, count });
  }
  return edits;
}
