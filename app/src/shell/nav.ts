// The views the sidebar can list, in one registry. A view that arrives later
// (Diagrams, Graph, Browser) needs one line here: an id, a label, an icon, a
// group, whether it is pinned until the person says otherwise, and, while its
// view is not there yet, an `available` that says no.
//
// The sidebar shows the pinned views (the person's choice, Settings and the
// "More views" list change it) and keeps a view that is not pinned in sight
// while it is the one open or has a count on it. Everything else is one click
// away in "More views".

import { useBrowserPrefs } from "../features/browser/prefs";
import { capturesPlace, capturesShown, isCapturesPlace } from "../features/extension/captures";
import { useReview } from "../features/review/store";
import type { Place, ViewId } from "../features/workspace/store";
import type { IconName } from "../ui/Icon";

/** A view's id. Rows that open another view's place (the Browser's tab, the
 * Captures database in the Tag Database) are named here too. */
export type NavId = ViewId | "browser" | "captures";

export type NavGroup = "capture" | "think" | "organise" | "tools";

export const NAV_GROUPS: readonly { id: NavGroup; label: string }[] = [
  { id: "capture", label: "Capture" },
  { id: "think", label: "Think" },
  { id: "organise", label: "Organise" },
  { id: "tools", label: "Tools" },
];

export interface NavItem {
  id: NavId;
  label: string;
  icon: IconName;
  group: NavGroup;
  /** Pinned to the sidebar until the person unpins it. */
  pinned?: boolean;
  /** While the view is there and not pinned, it is listed in the sidebar right
   * after this one: a view that comes and goes with a setting, kept beside what
   * it belongs with, without taking a place in the person's pinned order. */
  follows?: NavId;
  /** Whether the view is there to open; absent means it is. */
  available?: () => boolean;
}

/** Every view the sidebar can list, grouped as "More views" shows them. */
export const NAV: readonly NavItem[] = [
  { id: "inbox", label: "Inbox", icon: "inbox", group: "capture", pinned: true },
  // The `capture` tag's database; listed under the Inbox once there are captures or the browser or its extension is on.
  { id: "captures", label: "Captures", icon: "bookmark", group: "capture", follows: "inbox", available: capturesShown },
  { id: "journal", label: "Journal", icon: "journal", group: "capture", pinned: true },
  { id: "boards", label: "Whiteboards", icon: "board", group: "think" },
  { id: "diagrams", label: "Diagrams", icon: "diagram", group: "think" },
  { id: "slides", label: "Slides", icon: "present", group: "think" },
  { id: "graph", label: "Graph", icon: "graph", group: "think" },
  { id: "projects", label: "Projects", icon: "project", group: "organise" },
  { id: "library", label: "Card Library", icon: "library", group: "organise" },
  { id: "tags", label: "Tag Database", icon: "tag", group: "organise" },
  { id: "collections", label: "Collections", icon: "filter", group: "organise" },
  { id: "tasks", label: "Tasks", icon: "tasks", group: "organise", pinned: true },
  { id: "calendar", label: "Calendar", icon: "calendar", group: "organise", pinned: true },
  { id: "reviews", label: "Reviews", icon: "calendar-check", group: "organise" },
  { id: "highlights", label: "Highlights", icon: "highlight", group: "organise" },
  { id: "references", label: "References", icon: "book", group: "organise" },
  { id: "chat", label: "Chat", icon: "chat", group: "tools" },
  // Only once the browser is turned on in Settings.
  { id: "browser", label: "Browser", icon: "globe", group: "tools", available: () => useBrowserPrefs.getState().enabled },
  { id: "import", label: "Import", icon: "import", group: "tools" },
  { id: "history", label: "History", icon: "history", group: "tools" },
  { id: "trash", label: "Trash", icon: "trash", group: "tools" },
  // Only while agent proposals wait.
  { id: "review", label: "Review", icon: "review", group: "tools", available: () => useReview.getState().proposals.length > 0 },
];

/** Settings has its own button at the foot of the sidebar. */
export const SETTINGS_NAV: NavItem = { id: "settings", label: "Settings", icon: "settings", group: "tools" };

/** The tab a view's row opens: the Browser's row opens a browser tab, at its start page, and Captures the `capture` tag's database. */
export const placeOfNav = (id: string): Place => (id === "browser" ? { view: "web" } : id === "captures" ? capturesPlace : { view: id as ViewId });

/** Whether the focused tab shows the view of a row. The Captures database is
 * the Tag Database's too, but with its own row listed it is that row's. */
export function showsNav(open: Place, id: string): boolean {
  if (id === "captures") return isCapturesPlace(open);
  if (id === "tags" && isCapturesPlace(open)) return !capturesShown();
  return open.view === (id === "browser" ? "web" : id);
}

/** The views a person can open, as the sidebar lists them: those that are there. */
export const availableNav = (): NavItem[] => NAV.filter((item) => item.available?.() ?? true);

/** A view's entry, whether or not it is there to open: for its title. */
export function findNav(id: ViewId): NavItem | undefined {
  return NAV.find((n) => n.id === id) ?? (id === SETTINGS_NAV.id ? SETTINGS_NAV : undefined);
}

/** The ids pinned until the person chooses, in the registry's order. */
export const defaultPinned = (): NavId[] => NAV.filter((n) => n.pinned).map((n) => n.id);

/** The pinned ids for a saved list: the usual ones when none was saved,
 * else what was saved, less ids no view has (a view that went away) and repeats. */
export function pinnedIds(saved: readonly string[] | null): NavId[] {
  if (saved === null) return defaultPinned();
  const known = new Set<string>(NAV.map((n) => n.id));
  return [...new Set(saved)].filter((id): id is NavId => known.has(id));
}

/** What shows in the sidebar's views list: the pinned views in their
 * order, with each view that `follows` another (and is not pinned) right after
 * it, then the others that must stay in sight, the view open and the views
 * with a count, in the registry's order. Views that are not there yet never show. */
export function sidebarNav(pinned: readonly string[], keep: { open?: string; counted?: ReadonlySet<string> }, items: readonly NavItem[] = availableNav()): NavItem[] {
  const byId = new Map(items.map((item) => [item.id as string, item]));
  const list = pinned.map((id) => byId.get(id)).filter((item): item is NavItem => item !== undefined);
  const have = new Set(list.map((item) => item.id as string));
  for (const item of items) {
    if (!item.follows || have.has(item.id)) continue;
    // Right after the view it follows, or first when that one is not listed.
    list.splice(list.findIndex((listed) => listed.id === item.follows) + 1, 0, item);
    have.add(item.id);
  }
  const stays = items.filter((item) => !have.has(item.id) && (item.id === keep.open || keep.counted?.has(item.id)));
  return [...list, ...stays];
}

/** `items` by group, each group in the registry's order, keeping those whose label has `query` in it (any case); empty groups left out. */
export function groupedNav(items: readonly NavItem[], query = ""): { id: NavGroup; label: string; items: NavItem[] }[] {
  const text = query.trim().toLowerCase();
  return NAV_GROUPS.map((group) => ({ ...group, items: items.filter((i) => i.group === group.id && (!text || i.label.toLowerCase().includes(text))) })).filter((group) => group.items.length > 0);
}

/** The pinned list with `id` added at its end, or unchanged when it is there. */
export const pin = (pinned: readonly string[], id: string): string[] => (pinned.includes(id) ? [...pinned] : [...pinned, id]);

/** The pinned list without `id`. */
export const unpin = (pinned: readonly string[], id: string): string[] => pinned.filter((p) => p !== id);

/** The pinned list with `id` moved one place up (-1) or down (1); unchanged at an end. */
export function moveNav(pinned: readonly string[], id: string, step: -1 | 1): string[] {
  const list = [...pinned];
  const at = list.indexOf(id);
  const to = at + step;
  if (at < 0 || to < 0 || to >= list.length) return list;
  [list[at], list[to]] = [list[to]!, list[at]!];
  return list;
}
