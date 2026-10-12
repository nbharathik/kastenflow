// Where a quick capture goes: the Inbox, today's journal, a project or any
// page. Tab goes round the places, recent ones first; the picker lists them
// the same way and narrows them as you type, which is how any page is reached.

export type Target = { kind: "inbox" } | { kind: "journal" } | { kind: "project"; slug: string; title: string } | { kind: "page"; path: string; title: string };

export const INBOX: Target = { kind: "inbox" };
export const JOURNAL: Target = { kind: "journal" };

/** How many recent places are kept. */
export const MAX_RECENT = 8;
/** How many pages a typed word offers beyond the places listed. */
const MAX_PAGES = 10;

/** Every place, projects by title. */
export function targetsWith(projects: readonly { slug: string; title: string }[]): Target[] {
  const sorted = [...projects].sort((a, b) => a.title.localeCompare(b.title));
  return [INBOX, JOURNAL, ...sorted.map((p) => ({ kind: "project" as const, slug: p.slug, title: p.title }))];
}

export const sameTarget = (a: Target, b: Target): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "project") return b.kind === "project" && a.slug === b.slug;
  if (a.kind === "page") return b.kind === "page" && a.path === b.path;
  return true;
};

/** The place after `current`, or before it with `back`, going round. */
export function nextTarget(targets: readonly Target[], current: Target, back = false): Target {
  if (targets.length === 0) return INBOX;
  const at = targets.findIndex((t) => sameTarget(t, current));
  const step = back ? -1 : 1;
  const next = at < 0 ? 0 : (at + step + targets.length) % targets.length;
  return targets[next]!;
}

/** The place in words. */
export function placeName(target: Target): string {
  switch (target.kind) {
    case "inbox":
      return "Inbox";
    case "journal":
      return "Today's journal";
    case "project":
      return target.title;
    case "page":
      return target.title || "Untitled";
  }
}

/** A capture's title: its first line, without Markdown's marks. */
export function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.replace(/^[#>*\-\s[\]x]+/i, "").trim().slice(0, 80);
}

// Recent places, in the browser's storage for the window (`kasten.capture.recent`).

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

/** The stored recent places as targets, newest first: only those that read, once each, up to `MAX_RECENT`. */
export function readRecent(raw: string | null): Target[] {
  let saved: unknown;
  try {
    saved = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];
  const out: Target[] = [];
  for (const item of saved as Record<string, unknown>[]) {
    const target = ((): Target | null => {
      if (!item || typeof item !== "object") return null;
      if (item.kind === "inbox") return INBOX;
      if (item.kind === "journal") return JOURNAL;
      if (item.kind === "project" && isText(item.slug)) return { kind: "project", slug: item.slug, title: typeof item.title === "string" ? item.title : item.slug };
      if (item.kind === "page" && isText(item.path)) return { kind: "page", path: item.path, title: typeof item.title === "string" ? item.title : "" };
      return null;
    })();
    if (target && !out.some((t) => sameTarget(t, target))) out.push(target);
  }
  return out.slice(0, MAX_RECENT);
}

/** `target` first among the recent places, the rest after it as they were. */
export function remember(recent: readonly Target[], target: Target): Target[] {
  return [target, ...recent.filter((t) => !sameTarget(t, target))].slice(0, MAX_RECENT);
}

export interface Places {
  projects: readonly { slug: string; title: string }[];
  /** Recent places, newest first. */
  recent: readonly Target[];
  /** Every page that can be written to; empty until the notes are read. */
  pages: readonly { path: string; title: string; modified?: number }[];
}

/** The places in the order Tab goes through them and the picker lists them
 * with nothing typed: the recent ones first (those that still exist), then
 * the Inbox, today's journal and the projects not already listed. */
export function orderedTargets({ projects, recent, pages }: Places): Target[] {
  const known = new Set(pages.map((p) => p.path));
  const slugs = new Set(projects.map((p) => p.slug));
  const kept = recent.filter((t) => (t.kind === "project" ? slugs.has(t.slug) : t.kind === "page" ? known.size === 0 || known.has(t.path) : true));
  const named = kept.map((t) => (t.kind === "project" ? { ...t, title: projects.find((p) => p.slug === t.slug)?.title ?? t.title } : t));
  return [...named, ...targetsWith(projects).filter((t) => !named.some((n) => sameTarget(n, t)))];
}

/** What the picker lists for `query`: what starts with it first, so a letter
 * or two reaches a page, then what only holds it; in each, the places in the
 * order above, then pages, the latest changed first. Nothing typed lists only
 * the places. */
export function pickerChoices(query: string, places: Places): Target[] {
  const base = orderedTargets(places);
  const q = query.trim().toLowerCase();
  if (!q) return base;
  const matching = base.filter((t) => placeName(t).toLowerCase().includes(q));
  const pages = places.pages
    .filter((p) => p.title.toLowerCase().includes(q) && !base.some((t) => t.kind === "page" && t.path === p.path))
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
    .slice(0, MAX_PAGES)
    .map((p): Target => ({ kind: "page", path: p.path, title: p.title }));
  const starts = (t: Target) => Number(!placeName(t).toLowerCase().startsWith(q));
  // Array's sort keeps the order of what ties.
  return [...matching, ...pages].sort((a, b) => starts(a) - starts(b));
}

/** One step for a turn of the mouse wheel: down is next, up is back, a nudge too small to mean either is none. */
export const wheelStep = (deltaY: number): -1 | 0 | 1 => (Math.abs(deltaY) < 1 ? 0 : deltaY > 0 ? 1 : -1);

/** `index` moved `step` places along `count`, going round. */
export const around = (index: number, step: number, count: number): number => (count === 0 ? 0 : (((index + step) % count) + count) % count);
