// Bundles through Tauri commands, each a one-to-one wrapper over a
// kasten-core op (app/src-tauri/src/commands/bundles.rs). Importing a bundle
// is the Import view's `plan_import` / `import_notes`.

import { invoke } from "@tauri-apps/api/core";

import type { BundleExported, BundleOps, BundlePlan } from "./bundle-types";

export const tauriBundles: BundleOps = {
  planExport: (project) => invoke<BundlePlan>("plan_export", { project }),
  exportProject: (project, dest) => invoke<BundleExported>("export_project", { project, dest }),
};
