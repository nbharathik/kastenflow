// Project setups for the browser preview, from the same files the core ships
// (crates/kasten-core/defaults/setups) and planned the way the core plans them
// (engine/setups.rs): what is not there yet is created, what is there stays,
// and a project page that exists only gains the properties it lacks.

import type { AppliedSetup, SetupInfo, SetupPlan, SetupTarget } from "../../../lib/vault/project-types";
import { newId, slugify } from "./vault-text";

const ROOT = "../../../../../crates/kasten-core/defaults/setups/";
const FILES = import.meta.glob<string>("../../../../../crates/kasten-core/defaults/setups/*/**/*", { query: "?raw", import: "default", eager: true });

/** The order the core offers them in. */
export const SETUP_ORDER = ["research", "writing", "presentation"];

export interface Manifest {
  icon: string;
  name: string;
  summary: string;
  home: string;
  props: Record<string, unknown>;
}

/** A setup's files by path relative to its folder, `setup.json` apart. */
function filesOf(id: string): Record<string, string> {
  const prefix = `${ROOT}${id}/`;
  return Object.fromEntries(
    Object.entries(FILES)
      .filter(([key]) => key.startsWith(prefix) && key !== `${prefix}setup.json`)
      .map(([key, text]) => [key.slice(prefix.length), text]),
  );
}

function manifestOf(id: string): Manifest {
  const raw = FILES[`${ROOT}${id}/setup.json`];
  if (!raw) throw new Error(`There is no setup “${id}”`);
  return JSON.parse(raw) as Manifest;
}

const VAULT = "vault/";

export function setupInfos(): SetupInfo[] {
  return SETUP_ORDER.flatMap((id) => {
    if (!FILES[`${ROOT}${id}/setup.json`]) return [];
    const m = manifestOf(id);
    const paths = Object.keys(filesOf(id)).sort();
    return [
      {
        id,
        icon: m.icon,
        name: m.name,
        summary: m.summary,
        files: paths.filter((p) => !p.startsWith(VAULT)),
        tags: paths.filter((p) => p.startsWith(`${VAULT}tags/`)).map((p) => p.slice(`${VAULT}tags/`.length).replace(/\.yaml$/, "")),
      },
    ];
  });
}

/** What the preview's vault tells the planner. */
export interface SetupHost {
  /** Whether a file is in the vault. */
  exists(path: string): boolean;
  /** The title and properties of the project page at `path`; null when there is no such page. */
  page(path: string): { title: string; props: Record<string, unknown> } | null;
}

export interface Planned {
  plan: SetupPlan;
  title: string;
  folder: string;
  /** The vault path each file of the setup goes to, with its text filled in. */
  files: { path: string; text: string }[];
  /** The properties the project page lacks. */
  add: Record<string, unknown>;
  isNew: boolean;
}

/** Where a vault-level file of a setup goes in the vault, or the project folder's own. */
const placed = (folder: string, rel: string) => (rel.startsWith(VAULT) ? rel.slice(VAULT.length) : `projects/${folder}/${rel}`);

/** A setup the person saved: its manifest and its files by path relative to the project folder (`vault/…` goes to the vault). */
export interface CustomSetup {
  manifest: Manifest;
  files: Record<string, string>;
}

export function planSetup(id: string, target: SetupTarget, host: SetupHost, now: number, day: string, custom?: CustomSetup): Planned {
  const m = custom?.manifest ?? manifestOf(id);
  let folder: string;
  let title: string;
  let page: Record<string, unknown> | null = null;
  if (target.kind === "new") {
    title = target.title.trim();
    if (!title || /[[\]|\n\r]/.test(title)) throw new Error("A title needs some text and no [ ] or | characters");
    const base = slugify(title);
    folder = base;
    for (let n = 2; host.exists(`projects/${folder}/_project.md`); n++) folder = `${base}-${n}`;
  } else {
    folder = target.folder;
    const found = host.page(`projects/${folder}/_project.md`);
    if (!found) throw new Error(`No project called ${folder}`);
    title = found.title;
    page = found.props;
  }
  const ids = new Map<string, string>();
  const fill = (text: string, json: boolean) => {
    const put = (s: string) => (json ? JSON.stringify(s).slice(1, -1) : s);
    const idOf = (name: string) => ids.get(name) ?? ids.set(name, newId(now)).get(name)!;
    return text
      .replace(/\{\{project\}\}/g, () => put(title))
      .replace(/\{\{slug\}\}/g, folder)
      .replace(/\{\{date\}\}/g, day)
      .replace(/\{\{id8:([^}]+)\}\}/g, (_, name: string) => idOf(name).slice(-8).toLowerCase())
      .replace(/\{\{id:([^}]+)\}\}/g, (_, name: string) => idOf(name));
  };
  const files = Object.entries(custom?.files ?? filesOf(id))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([rel, text]) => ({ path: placed(folder, rel), text: fill(text, /\.(deck|canvas)$/.test(rel)) }));
  const projectPath = `projects/${folder}/_project.md`;
  const create = files.filter((f) => !host.exists(f.path)).map((f) => f.path);
  const keep = files.filter((f) => host.exists(f.path)).map((f) => f.path);
  const add = Object.fromEntries(Object.entries(m.props).filter(([key]) => !page || page[key] === undefined || page[key] === null));
  const isNew = target.kind === "new";
  const props = Object.keys(add);
  return {
    plan: { projectPath, home: `projects/${folder}/${m.home}`, create: isNew || props.length ? [projectPath, ...create] : create, keep, props },
    title,
    folder,
    files: files.filter((f) => create.includes(f.path)),
    add,
    isNew,
  };
}

/** The result of applying a plan, in the shape the client returns. */
export const appliedFrom = (plan: SetupPlan): AppliedSetup => ({ projectPath: plan.projectPath, home: plan.home, written: plan.create, kept: plan.keep, commit: null });
