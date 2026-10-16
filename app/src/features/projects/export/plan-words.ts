// What exporting a project would put in its bundle, in words: counts by kind of
// file, the size, what is left out, and the name of the bundle's folder.

import type { BundleFile, BundlePlan } from "../../../lib/vault/bundle-types";

/** What never goes in a bundle, whatever is exported. Said in the dialog before anything is written. */
export const NOT_INCLUDED = "Not in the bundle: credentials and API keys, the vault's history, chats and the trash.";

export interface Group {
  /** Plural, as a heading or a list item. */
  label: string;
  /** For a count of one. */
  one: string;
  count: number;
}

/** A group's count in a sentence: "1 card", "3 pages". */
const phrase = (g: Group) => `${g.count} ${g.count === 1 ? g.one : g.label}`;

/** The size of `bytes` as a person reads it. */
export function megabytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}

type Part = (f: BundleFile) => boolean;
const ends = (f: BundleFile, ...suffixes: string[]) => suffixes.some((s) => f.path.endsWith(s));

/** The kinds a bundle's files fall into, in the order they are told. */
const KINDS: { label: string; one: string; has: Part }[] = [
  { label: "pages", one: "page", has: (f) => f.kind === "project" && ends(f, ".md") && !f.path.includes("/cards/") },
  { label: "cards", one: "card", has: (f) => f.kind === "project" && ends(f, ".md") && f.path.includes("/cards/") },
  { label: "whiteboards", one: "whiteboard", has: (f) => f.kind === "project" && ends(f, ".canvas") },
  { label: "decks", one: "deck", has: (f) => f.kind === "project" && ends(f, ".deck") },
  // A diagram is its `.drawio`; the `.drawio.svg` beside it is its picture, not another diagram.
  { label: "diagrams", one: "diagram", has: (f) => f.kind === "project" && f.path.endsWith(".drawio") },
  { label: "other files", one: "other file", has: (f) => f.kind === "project" && !ends(f, ".md", ".canvas", ".deck", ".drawio", ".drawio.svg") },
  { label: "pictures and files", one: "picture or file", has: (f) => f.kind === "asset" },
  { label: "PDFs", one: "PDF", has: (f) => f.kind === "source" },
  { label: "tag databases", one: "tag database", has: (f) => f.kind === "tag" },
];

/** The bundle's files counted by kind, the bibliography by the entries it holds; kinds with nothing in them left out. */
export function groupsOf(plan: BundlePlan): Group[] {
  const groups: Group[] = KINDS.map((k) => ({ label: k.label, one: k.one, count: plan.files.filter(k.has).length }));
  if (plan.files.some((f) => f.kind === "references")) groups.push({ label: "bibliography entries", one: "bibliography entry", count: plan.references.length });
  return groups.filter((g) => g.count > 0);
}

export interface PlanWords {
  /** "3 pages, 1 card and 2 pictures and files · 5.4 MB" */
  summary: string;
  groups: Group[];
  /** What the bundle leaves out of the project's reach, as the core says it. */
  outside: string[];
  /** Citation keys that go without an entry, in a sentence; none when there are none. */
  missing: string | null;
}

export function planWords(plan: BundlePlan): PlanWords {
  const groups = groupsOf(plan);
  const parts = groups.map(phrase);
  const listed = parts.length <= 1 ? (parts[0] ?? "nothing") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return {
    summary: `${listed} · ${megabytes(plan.bytes)}`,
    groups,
    outside: plan.outside,
    missing: plan.missingReferences.length > 0 ? `Cited in the project but in no bibliography file, so they go without an entry: ${plan.missingReferences.join(", ")}.` : null,
  };
}

/** A folder name for the bundle of a project: its title (or folder) as a file name, then `-bundle`. */
export function bundleName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "project"}-bundle`;
}

/** `name` inside the folder `parent`, with the separator the folder uses. */
export function joinPath(parent: string, name: string): string {
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${name}`;
}
