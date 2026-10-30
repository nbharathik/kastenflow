// Setups saved from a project, for the browser preview, worked the way the
// core works them (engine/setup_save.rs): the project's starting pages as
// skeletons, the schemas of its tags and its default properties. The preview
// keeps them for the session only; inside the app they are files in the
// vault's templates folder.

import type { NoteMeta } from "../../../lib/vault/types";
import type { SavedSetup, SetupInfo, SetupSource } from "../../../lib/vault/project-types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { setFrontmatterKey } from "../../pages/page/page-meta";
import type { Manifest } from "./memory-setups";
import { slugify } from "./vault-text";

export const SAVED_PREFIX = "saved:";
/** The properties of a project page that say how far along it is: a new project starts without them. */
const STATE_KEYS = ["status", "health", "next_action", "last_review", "review_after"];
const MAX_PAGES = 60;
const MAX_NAME = 100;

/** A saved setup: its manifest, its skeleton pages (`pages/x.md`) and its schemas (`vault/tags/x.yaml`), by path. */
export interface Saved {
  slug: string;
  manifest: Manifest;
  files: Record<string, string>;
}

export const idOf = (slug: string) => `${SAVED_PREFIX}${slug}`;

export function infoOf(saved: Saved): SetupInfo {
  const paths = Object.keys(saved.files).sort();
  return {
    id: idOf(saved.slug),
    icon: saved.manifest.icon,
    name: saved.manifest.name,
    summary: saved.manifest.summary,
    files: paths.filter((p) => !p.startsWith("vault/")),
    tags: paths.filter((p) => p.startsWith("vault/tags/")).map((p) => p.slice("vault/tags/".length).replace(/\.yaml$/, "")),
    saved: true,
  };
}

/** A name: one line of text. */
export function checkName(name: string): string {
  const trimmed = name.trim();
  // A control character is code 0 to 31 or 127.
  const control = [...trimmed].some((letter) => letter.charCodeAt(0) < 32 || letter.charCodeAt(0) === 127);
  if (!trimmed || [...trimmed].length > MAX_NAME || control) throw new Error(`A setup's name is some text on one line, up to ${MAX_NAME} characters`);
  return trimmed;
}

/** What a vault tells this module about a project. */
export interface SourceHost {
  notes: readonly NoteMeta[];
  textOf(path: string): string;
  /** The tag schemas the vault has, by path (`tags/x.yaml`). */
  tagYaml: Record<string, string>;
  /** The name a schema file gives its tag. */
  tagName(path: string, yaml: string): string;
}

function projectIn(host: SourceHost, input: string): { folder: string; page: NoteMeta } {
  const folder = input.trim().replace(/^projects\//, "").replace(/\/_project\.md$/, "");
  const page = host.notes.find((n) => n.kind === "project" && n.path.toLowerCase() === `projects/${folder.toLowerCase()}/_project.md`);
  if (!folder || /[\\/:]/.test(folder) || !page) throw new Error(`There is no project called “${input.trim()}”`);
  return { folder: page.path.split("/")[1]!, page };
}

const direct = (path: string, folder: string) => new RegExp(`^projects/${folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/pages/[^/]+$`).test(path);

function schemaStems(host: SourceHost, folder: string): string[] {
  const stems = new Set<string>();
  for (const note of host.notes.filter((n) => n.project === folder && n.kind !== "template")) {
    for (const tag of note.tags) {
      const name = tag.replace(/^#/, "").toLowerCase();
      const path = Object.keys(host.tagYaml).find((p) => host.tagName(p, host.tagYaml[p]!).toLowerCase() === name);
      const stem = path?.replace(/^tags\//, "").replace(/\.yaml$/, "");
      if (stem && slugify(stem) === stem) stems.add(stem);
    }
  }
  return [...stems].sort();
}

const keptProps = (page: NoteMeta) => Object.fromEntries(Object.entries(page.props ?? {}).filter(([k, v]) => v !== null && v !== undefined && !STATE_KEYS.includes(k.toLowerCase())));

export function sourceOf(host: SourceHost, project: string): SetupSource {
  const { folder, page } = projectIn(host, project);
  const pages = host.notes
    .filter((n) => n.kind === "page" && n.path.startsWith(`projects/${folder}/`) && n.path.endsWith(".md"))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .slice(0, 500)
    .map((n) => ({ path: n.path, title: n.title, included: direct(n.path, folder) }));
  return { folder, title: page.title, pages, tags: schemaStems(host, folder), props: Object.keys(keptProps(page)) };
}

/** A page as a setup keeps it: its own text but for the lines that name this page (setup_skeleton.rs). */
export function skeleton(text: string, id: string, parent: string | null, project: string): string {
  const { prefix, body } = splitFrontmatter(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let head = setFrontmatterKey(prefix, "id", `"{{id:${id}}}"`, eol, true);
  head = parent ? setFrontmatterKey(head, "parent", `"{{id:${parent}}}"`, eol, true) : setFrontmatterKey(head, "parent", null, eol);
  for (const key of ["created", "updated", "locked", "children_order"]) head = setFrontmatterKey(head, key, null, eol);
  return head + ([...project].length >= 3 ? body.split(project).join("{{project}}") : body);
}

/** The icon a setup shows: the project's own emoji, else a folder. */
const iconOf = (page: NoteMeta) => (page.icon && [...page.icon].length <= 8 && !/^[A-Za-z0-9-]+$/.test(page.icon) ? page.icon : "🗂️");

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summaryOf(pages: number, tags: number): string {
  if (!pages && !tags) return "A project to start from, kept as it is.";
  const parts = [pages ? plural(pages, "page", "pages") : "", tags ? plural(tags, "tag database", "tag databases") : ""].filter(Boolean);
  return `${parts.join(" and ")} saved from one of your projects.`;
}

/** Saves the project: `taken` says which file names are used already. */
export function saveSetup(host: SourceHost, project: string, title: string, pagePaths: string[], taken: (slug: string) => boolean, slugGiven = ""): { saved: Saved; result: SavedSetup } {
  const name = checkName(title);
  const base = slugGiven || slugify(name);
  if (slugify(base) !== base) throw new Error("A setup's file name is letters, digits and dashes only");
  const { folder, page } = projectIn(host, project);
  const wanted = [...new Set(pagePaths)].sort();
  if (wanted.length > MAX_PAGES) throw new Error(`A setup keeps at most ${MAX_PAGES} pages`);
  const sources = wanted.map((path) => {
    const note = host.notes.find((n) => n.path === path);
    if (!path.startsWith(`projects/${folder}/`) || path.includes("..")) throw new Error(`“${path}” is not a page of this project`);
    if (!note) throw new Error(`“${path}” is no longer there`);
    if (note.kind !== "page") throw new Error(`“${note.title}” is a ${note.kind}, and only pages are kept in a setup`);
    return note;
  });
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  const ids = new Map(sources.flatMap((s, n) => (s.id ? [[s.id, `p${n + 1}`] as const] : [])));
  const files: Record<string, string> = {};
  const used = new Set<string>();
  sources.forEach((note, n) => {
    let file = note.path.split("/").at(-1)!;
    for (let k = 2; used.has(file.toLowerCase()); k++) file = `${note.path.split("/").at(-1)!.replace(/\.md$/, "")}-${k}.md`;
    used.add(file.toLowerCase());
    const parent = note.parent ? (ids.get(note.parent) ?? null) : null;
    files[`pages/${file}`] = skeleton(host.textOf(note.path), `p${n + 1}`, parent, page.title);
  });
  const stems = schemaStems(host, folder);
  for (const stem of stems) files[`vault/tags/${stem}.yaml`] = host.tagYaml[`tags/${stem}.yaml`]!;
  const pageFiles = Object.keys(files).filter((p) => p.startsWith("pages/")).sort();
  const manifest: Manifest = { icon: iconOf(page), name, summary: summaryOf(pageFiles.length, stems.length), home: pageFiles[0] ?? "_project.md", props: keptProps(page) };
  return { saved: { slug, manifest, files }, result: { id: idOf(slug), slug, name, written: [`templates/setups/${slug}.yaml`, ...Object.keys(files).map((p) => `templates/setups/${slug}/${p}`)], commit: null } };
}
