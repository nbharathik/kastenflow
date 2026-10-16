// References through Tauri commands, each a one-to-one wrapper over a
// kasten-core op (app/src-tauri/src/commands/references.rs).

import { invoke } from "@tauri-apps/api/core";

import type { Adopted, Bibliography, KeyHints, KeyRenamePlan, KeyRenamed, KeyUses, NewReference, ReferenceMatch, ReferenceOps, ReferenceSaved } from "./reference-types";

export const tauriReferences: ReferenceOps = {
  bibliography: () => invoke<Bibliography>("bibliography"),
  checkReference: (reference) => invoke<ReferenceMatch[]>("check_reference", { reference }),
  suggestKey: (hints: KeyHints) => invoke<string>("suggest_key", { hints }),
  addReference: (reference: NewReference, baseHash) => invoke<ReferenceSaved>("add_reference", { reference, baseHash }),
  updateReference: (key, fields, baseHash) => invoke<ReferenceSaved>("update_reference", { key, fields, baseHash }),
  replaceReference: (key, text, baseHash) => invoke<ReferenceSaved>("replace_reference", { key, text, baseHash }),
  adoptBib: (path, keys, baseHash) => invoke<Adopted>("adopt_bib", { path, keys, baseHash }),
  referenceUses: (key) => invoke<KeyUses>("reference_uses", { key }),
  planKeyRename: (from, to) => invoke<KeyRenamePlan>("plan_key_rename", { from, to }),
  renameCitationKey: (from, to, bibHash) => invoke<KeyRenamed>("rename_citation_key", { from, to, bibHash }),
};
