// Annotations through Tauri commands, each a one-to-one wrapper over a
// kasten-core op (app/src-tauri/src/commands/annotations.rs).

import { invoke } from "@tauri-apps/api/core";

import type { AnnotationOps, PageComment, TextHighlight } from "./annotation-types";

export const tauriAnnotations: AnnotationOps = {
  comments: (page) => invoke<PageComment[]>("comments", { page }),
  addComment: (page, comment) => invoke<PageComment>("add_comment", { page, comment }),
  resolveComment: (page, id, resolved) => invoke<PageComment>("resolve_comment", { page, id, resolved }),
  reanchorComment: (page, id, anchor) => invoke<PageComment>("reanchor_comment", { page, id, anchor }),
  textHighlights: (note) => invoke<TextHighlight[]>("text_highlights", { note }),
  addTextHighlight: (note, highlight) => invoke<TextHighlight>("add_text_highlight", { note, highlight }),
  editTextHighlight: (note, id, edit) => invoke<TextHighlight>("edit_text_highlight", { note, id, edit }),
  moveTextHighlight: (note, id, anchor) => invoke<TextHighlight>("move_text_highlight", { note, id, anchor }),
  removeTextHighlight: (note, id) => invoke<void>("remove_text_highlight", { note, id }),
};
