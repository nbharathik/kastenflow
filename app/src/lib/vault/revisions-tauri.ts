// The vault's revision through Tauri commands, each a one-to-one wrapper
// over a kasten-core op (app/src-tauri/src/commands/vault.rs).

import { invoke } from "@tauri-apps/api/core";

import type { Revision, RevisionOps } from "./revision-types";

export const tauriRevisions: RevisionOps = {
  revision: () => invoke<Revision>("vault_revision"),
};
