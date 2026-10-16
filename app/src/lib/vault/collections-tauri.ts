// Saved collections through Tauri commands, each a one-to-one wrapper over a
// kasten-core op (app/src-tauri/src/commands/collections.rs), and the calls
// about a page that is already saved (app/src-tauri/src/clip.rs).

import { invoke } from "@tauri-apps/api/core";

import type { Collection, CollectionOps, ClipOutcome, TagAdded } from "./collection-types";
import type { NoteMeta } from "./note-types";

export const tauriCollections: CollectionOps = {
  collections: () => invoke<Collection[]>("collections"),
  collection: (path) => invoke<Collection>("collection", { path }),
  createCollection: (name, edits) => invoke<Collection>("create_collection", { name, edits: edits ?? {} }),
  updateCollection: (path, edits, baseHash) => invoke<Collection>("update_collection", { path, edits, baseHash }),
  renameCollection: (path, name, baseHash) => invoke<Collection>("rename_collection", { path, name, baseHash }),
  trashCollection: (path) => invoke<string>("trash_collection", { path }),
  restoreCollection: (trashed) => invoke<Collection>("restore_collection", { trashed }),
  capturedFrom: (url) => invoke<NoteMeta[]>("captured_from", { url }),
  clipPage: (url, again) => invoke<ClipOutcome>("clip_url", { url, again: again ?? false }),
  addTagToMany: (paths, tag) => invoke<TagAdded>("add_tag_to_many", { paths, tag }),
};
