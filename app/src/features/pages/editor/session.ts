// One note open in the editor: load its body through the lossless layer, and
// write it back so that unchanged blocks keep their exact bytes.

import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { Fragment, type Node } from "@milkdown/kit/prose/model";

import { loadMarkdown, rebaseSnapshot, saveMarkdown } from "../markdown/lossless";
import { loadedBlocks, type LoadedBlock } from "../markdown/marked-blocks";
import { milkdownCodec, topLevel } from "./milkdown-codec";
import { LOAD_META } from "./sections/key";

export interface OpenNote {
  /** The body as it should be written to disk now. */
  save(): string;
  /** The top-level blocks as loaded: the lines of the body each spans, and
   * the editor's nodes for it. Agent marks come by line. */
  readonly blocks: readonly LoadedBlock<Node>[];
}

/** Replaces the editor's document with `body`. Loading is not undoable. */
export function openNote(crepe: Crepe, body: string): OpenNote {
  const ctx = crepe.editor.ctx;
  const codec = milkdownCodec(ctx);
  const view = ctx.get(editorViewCtx);
  const loaded = loadMarkdown(codec, body);
  const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, Fragment.from(loaded.nodes));
  // Opening a page: the sections folded last time are folded again.
  view.dispatch(tr.setMeta("addToHistory", false).setMeta(LOAD_META, true));
  const snapshot = rebaseSnapshot(codec, loaded.snapshot, topLevel(view.state.doc));
  return {
    save: () => saveMarkdown(codec, snapshot, topLevel(ctx.get(editorViewCtx).state.doc)),
    blocks: loadedBlocks(snapshot),
  };
}
