// Bundles: a project exported to a folder outside the vault, and imported
// back from one (the shapes of kasten-core's bundle ops, serde camelCase) and
// the calls the app makes.
//
// A bundle is a folder: the project's folder and sidecars, the pictures and
// PDFs it uses (with their sidecars), the tag schemas it uses and the cited
// works as `references.bib`, with a manifest, `kastenflow-bundle.json`, that
// lists every file with its size and SHA-256. Nothing from the vault's
// history, `.kasten/`, trash or chats goes in. Importing is the Import view's:
// `planImport`/`importNotes` on a bundle folder (kind `bundle`, found by the
// manifest) work out the conflicts (`ImportSummary.conflicts`) and write
// everything as one commit.

import type { DraftRule } from "./draft-rule";

/** The manifest's file name, at the top of a bundle. */
export const BUNDLE_MANIFEST = "kastenflow-bundle.json";

/** What a file of a bundle is. */
export type BundleFileKind = "project" | "asset" | "source" | "tag" | "references";

export interface BundleFile {
  /** The vault path it has in the vault and in the bundle (`references.bib` is at the top of the bundle). */
  path: string;
  bytes: number;
  kind: BundleFileKind;
}

export interface BundleProject {
  /** The folder under `projects/`. */
  folder: string;
  title: string;
  id: string | null;
}

/** What exporting a project would put in the bundle, worked out without writing anything. */
export interface BundlePlan {
  project: BundleProject;
  files: BundleFile[];
  bytes: number;
  /** The keys whose entries go into `references.bib`. */
  references: string[];
  /** Keys the project cites that are in no `.bib` file. */
  missingReferences: string[];
  /** What the bundle leaves out, in sentences: "3 links lead to notes outside the project". */
  outside: string[];
}

/** What an export wrote. */
export interface BundleExported {
  /** The folder it was written to. */
  dest: string;
  files: number;
  bytes: number;
  references: number;
  outside: string[];
}

export interface BundleOps {
  /** What exporting the project in `projects/<project>/` would put in a bundle. */
  planExport(project: string): Promise<BundlePlan>;
  /** Writes the bundle into `dest`, a new folder or an empty one outside the vault. Nothing in the vault changes, and no commit is made. */
  exportProject(project: string, dest: string): Promise<BundleExported>;
}

/** What a call about a draft does, for each call of `BundleOps`. */
export const BUNDLE_RULES = {
  planExport: "pass",
  exportProject: "pass",
} as const satisfies Record<keyof BundleOps, DraftRule>;
