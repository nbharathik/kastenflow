// The browser preview's part for annotations: comments and text highlights
// on pages (the client's annotation calls, `AnnotationOps`). Inside the app the
// core does these (engine/annotations.rs); here each page's two files are texts
// kept with the rest of the preview's data (`sidecars`, beside the PDFs'), and
// they go wherever the page goes: renamed, moved, copied, trashed, restored.

import { ANNOTATION_LIMITS, type AnnotationOps, type CommentAnchor, type NewComment, type NewTextHighlight, type PageComment, type TextAnchor, type TextHighlight, type TextHighlightEdit } from "../../../lib/vault/annotation-types";
import type { NoteFile, Trashed } from "../../../lib/vault/types";
import { COMMENTS, HIGHLIGHTS, SUFFIXES, anchorItem, checkAnchor, checkColor, checkCommentLength, checkCommentText, checkTextAnchor, commentOf, highlightOf, isSidecar, itemsOf, parseDoc, sidecarOf, textAnchorItem, writeDoc, type Doc, type Item } from "./annotation-text";
import { MemoryCollections } from "./memory-collections";
import { newId, stamps } from "./vault-text";

const COMMENTS_KEY = "comments";
const HIGHLIGHTS_KEY = "highlights";

/** The file of the note's `suffix` that is the note's own: a note under sources/ does not own a PDF's highlights. */
const owned = (note: string, suffix: string) => (suffix === HIGHLIGHTS && note.startsWith("sources/") ? null : sidecarOf(note, suffix));

export class MemoryAnnotations extends MemoryCollections implements AnnotationOps {
  private commentsDoc(page: string): Doc {
    return parseDoc(this.data.sidecars?.[sidecarOf(page, COMMENTS)!], COMMENTS_KEY, "kasten-comments", "a comments file");
  }

  private highlightsDoc(note: string): Doc {
    return parseDoc(this.data.sidecars?.[sidecarOf(note, HIGHLIGHTS)!], HIGHLIGHTS_KEY, "kasten-text-highlights", "a text highlights file");
  }

  private save(note: string, suffix: string, doc: Doc, key: string): void {
    (this.data.sidecars ??= {})[sidecarOf(note, suffix)!] = writeDoc(doc, key);
    this.persist();
  }

  /** The note an annotation goes on: in the vault, and not a template. */
  private annotated(note: string): NoteFile {
    if (note.startsWith("templates/")) throw new Error("A template has no comments or highlights");
    return this.get(note);
  }

  // ---- comments

  async comments(page: string): Promise<PageComment[]> {
    this.get(page);
    return itemsOf(this.commentsDoc(page), COMMENTS_KEY).flatMap((item) => commentOf(item) ?? []);
  }

  async addComment(page: string, comment: NewComment): Promise<PageComment> {
    this.annotated(page);
    checkCommentText(comment.text);
    checkAnchor(comment.anchor);
    const doc = this.commentsDoc(page);
    const items = itemsOf(doc, COMMENTS_KEY);
    if (items.length >= ANNOTATION_LIMITS.comments) throw new Error(`A page keeps at most ${ANNOTATION_LIMITS.comments} comments`);
    const item: Item = { id: `c-${newId(this.now())}`, anchor: anchorItem(comment.anchor), text: comment.text.trim(), author: "you", created: stamps(this.now()).rfc3339 };
    items.push(item);
    this.save(page, COMMENTS, doc, COMMENTS_KEY);
    return commentOf(item)!;
  }

  /** The comment `id` of `page` and its file. */
  private found(page: string, id: string): { doc: Doc; item: Item } {
    this.annotated(page);
    const doc = this.commentsDoc(page);
    const item = itemsOf(doc, COMMENTS_KEY).find((entry) => entry.id === id);
    if (!item) throw new Error(`No comment ${id} on this page`);
    return { doc, item };
  }

  async resolveComment(page: string, id: string, resolved: boolean): Promise<PageComment> {
    const { doc, item } = this.found(page, id);
    const was = item.resolved !== undefined && item.resolved !== null;
    if (resolved && !was) item.resolved = { at: stamps(this.now()).rfc3339, by: "you" };
    else if (!resolved && was) delete item.resolved;
    else return commentOf(item)!;
    this.save(page, COMMENTS, doc, COMMENTS_KEY);
    return commentOf(item)!;
  }

  async reanchorComment(page: string, id: string, anchor: CommentAnchor): Promise<PageComment> {
    checkAnchor(anchor);
    const { doc, item } = this.found(page, id);
    const old = typeof item.anchor === "object" && item.anchor !== null && !Array.isArray(item.anchor) ? (item.anchor as Item) : {};
    const next = anchorItem(anchor, old);
    if (JSON.stringify(next) !== JSON.stringify(item.anchor)) {
      item.anchor = next;
      this.save(page, COMMENTS, doc, COMMENTS_KEY);
    }
    return commentOf(item)!;
  }

  // ---- highlights on a captured page

  async textHighlights(note: string): Promise<TextHighlight[]> {
    this.get(note);
    if (note.startsWith("sources/")) return [];
    return itemsOf(this.highlightsDoc(note), HIGHLIGHTS_KEY).flatMap((item) => highlightOf(item) ?? []);
  }

  /** The highlights file of `note`, which must be a page that can be highlighted. */
  private highlighted(note: string): Doc {
    this.annotated(note);
    if (note.startsWith("sources/")) throw new Error("A note in sources has the name of a PDF's highlights file, so it cannot be highlighted. Rename the page or the PDF");
    return this.highlightsDoc(note);
  }

  async addTextHighlight(note: string, highlight: NewTextHighlight): Promise<TextHighlight> {
    const doc = this.highlighted(note);
    checkTextAnchor(highlight.anchor);
    checkColor(highlight.color);
    checkCommentLength(highlight.comment ?? "");
    const items = itemsOf(doc, HIGHLIGHTS_KEY);
    if (items.length >= ANNOTATION_LIMITS.highlights) throw new Error(`A page keeps at most ${ANNOTATION_LIMITS.highlights} highlights`);
    const item: Item = { id: `h-${newId(this.now())}`, anchor: textAnchorItem(highlight.anchor), color: highlight.color };
    const comment = highlight.comment?.trim();
    if (comment) item.comment = comment;
    item.created = stamps(this.now()).rfc3339;
    items.push(item);
    this.save(note, HIGHLIGHTS, doc, HIGHLIGHTS_KEY);
    return highlightOf(item)!;
  }

  private highlightEntry(note: string, id: string): { doc: Doc; item: Item } {
    const doc = this.highlighted(note);
    const item = itemsOf(doc, HIGHLIGHTS_KEY).find((entry) => entry.id === id);
    if (!item) throw new Error(`No highlight ${id} on this page`);
    return { doc, item };
  }

  async editTextHighlight(note: string, id: string, edit: TextHighlightEdit): Promise<TextHighlight> {
    if (edit.color !== undefined) checkColor(edit.color);
    if (edit.comment !== undefined) checkCommentLength(edit.comment);
    const { doc, item } = this.highlightEntry(note, id);
    const before = JSON.stringify(item);
    if (edit.color !== undefined) item.color = edit.color;
    if (edit.comment !== undefined) {
      if (edit.comment.trim()) item.comment = edit.comment.trim();
      else delete item.comment;
    }
    if (JSON.stringify(item) !== before) this.save(note, HIGHLIGHTS, doc, HIGHLIGHTS_KEY);
    return highlightOf(item)!;
  }

  async moveTextHighlight(note: string, id: string, anchor: TextAnchor): Promise<TextHighlight> {
    checkTextAnchor(anchor);
    const { doc, item } = this.highlightEntry(note, id);
    const old = typeof item.anchor === "object" && item.anchor !== null && !Array.isArray(item.anchor) ? (item.anchor as Item) : {};
    const next = textAnchorItem(anchor, old);
    if (JSON.stringify(next) !== JSON.stringify(item.anchor)) {
      item.anchor = next;
      this.save(note, HIGHLIGHTS, doc, HIGHLIGHTS_KEY);
    }
    return highlightOf(item)!;
  }

  async removeTextHighlight(note: string, id: string): Promise<void> {
    const { doc } = this.highlightEntry(note, id);
    const items = itemsOf(doc, HIGHLIGHTS_KEY);
    items.splice(items.findIndex((entry) => entry.id === id), 1);
    this.save(note, HIGHLIGHTS, doc, HIGHLIGHTS_KEY);
  }

  // ---- the files go wherever the page goes

  /** A page is not given the name of a comments or highlights file that is there, even a stray one. */
  protected override freePath(dir: string, name: string): string {
    for (let n = 1; ; n++) {
      const file = n === 1 ? `${name}.md` : `${name}-${n}.md`;
      const candidate = dir ? `${dir}/${file}` : file;
      const stray = SUFFIXES.some((suffix) => {
        const side = owned(candidate, suffix);
        return side !== null && this.data.sidecars?.[side] !== undefined;
      });
      if (!this.data.files[candidate] && !stray) return candidate;
    }
  }

  protected override carry(from: string, to: string): void {
    super.carry(from, to);
    const store = this.data.sidecars;
    if (!store) return;
    for (const suffix of SUFFIXES) {
      const [a, b] = [owned(from, suffix), owned(to, suffix)];
      if (!a || !b || a === b || store[a] === undefined) continue;
      store[b] = store[a];
      delete store[a];
    }
  }

  override async trash(path: string): Promise<string> {
    const before = new Set(Object.keys(this.data.trash));
    const trashed = await super.trash(path);
    const when = this.data.trash[trashed]?.when;
    const store = this.data.sidecars;
    if (when && store) {
      // Each page that went takes its files to the same trash folder.
      for (const [key, entry] of Object.entries(this.data.trash)) {
        if (entry.when !== when || before.has(key) || !key.endsWith(".md")) continue;
        for (const suffix of SUFFIXES) {
          const side = owned(entry.original, suffix);
          if (!side || store[side] === undefined) continue;
          this.data.trash[`.trash/${when}/${side}`] = { text: store[side], when, original: side };
          delete store[side];
        }
      }
      this.persist();
    }
    return trashed;
  }

  /** The files that went with a page are not listed apart. */
  override async listTrash(): Promise<Trashed[]> {
    return (await super.listTrash()).filter((item) => !isSidecar(item.original));
  }

  override async restore(trashed: string): Promise<NoteFile> {
    const entry = this.data.trash[trashed];
    const group = entry?.original.endsWith(".md") ? Object.entries(this.data.trash).filter(([key, t]) => t.when === entry.when && key.endsWith(".md")) : [];
    const had = new Set(Object.keys(this.data.files));
    const note = await super.restore(trashed);
    for (const [key, page] of group) {
      if (this.data.trash[key]) continue;
      // The page is back, under its name or a free one: found by its text.
      const now = Object.entries(this.data.files).find(([path, file]) => !had.has(path) && file.text === page.text)?.[0];
      if (!now) continue;
      for (const suffix of SUFFIXES) {
        const [side, to] = [owned(page.original, suffix), owned(now, suffix)];
        const kept = side ? this.data.trash[`.trash/${page.when}/${side}`] : undefined;
        if (!kept || !to) continue;
        (this.data.sidecars ??= {})[to] = kept.text;
        delete this.data.trash[`.trash/${page.when}/${side}`];
      }
    }
    this.persist();
    return note;
  }

  override async duplicate(path: string): Promise<NoteFile> {
    const copy = await super.duplicate(path);
    const store = this.data.sidecars;
    if (store) {
      for (const suffix of SUFFIXES) {
        const [from, to] = [owned(path, suffix), owned(copy.meta.path, suffix)];
        if (from && to && store[from] !== undefined) store[to] = store[from];
      }
      this.persist();
    }
    return copy;
  }
}
