// The database picker: /database, and /table view, /board view and the
// other views. A new database named as typed comes first,
// then the tag databases whose tags match, the biggest first. With a view
// kind, the embed opens on a view of that kind, one added when the tag has
// none. Picks can take a moment (a database made, a view added), so they
// hand over a promise of the link to place.

import type { TagViewKind } from "../../../../lib/vault/types";
import { tagFrom, type LinkProvider } from "../links";
import type { MenuItem, MenuSection } from "../ui/popover";

const MAX = 8;

export const VIEW_NAMES: Record<TagViewKind, string> = { table: "Table", kanban: "Board", list: "List", gallery: "Gallery", calendar: "Calendar" };

/** The picker's name: "Table view", or "Show a tag database". */
export const databaseLabel = (view: TagViewKind | undefined) => (view ? `${VIEW_NAMES[view]} view` : "Show a tag database");

/** `![[tags/paper.yaml#Board]]`'s target, or the file alone for its first view. */
const target = (path: string, view: string | null | undefined) => (view ? `${path}#${view}` : path);

export function databaseSections(query: string, links: LinkProvider, view: TagViewKind | undefined, pick: (link: string | Promise<string | null>) => void): MenuSection[] {
  const q = query.trim().toLowerCase();
  const all = links.databases?.() ?? [];
  const found = all
    .filter((d) => d.tag.toLowerCase().includes(q))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX);
  const items: MenuItem[] = found.map((d) => ({
    key: `db:${d.path}`,
    label: `#${d.tag}`,
    hint: `${d.count} ${d.count === 1 ? "note" : "notes"}`,
    icon: "icon:database",
    onPick: () => pick(view && links.viewOf ? links.viewOf(d.tag, view).then((name) => target(d.path, name)) : d.path),
  }));
  // In a project's page, a tag's view of what is filed in that project comes first.
  const here: MenuItem[] = view
    ? []
    : all
        .filter((d) => d.inThisProject && d.tag.toLowerCase().includes(q))
        .sort((a, b) => b.inThisProject!.count - a.inThisProject!.count)
        .slice(0, MAX)
        .map((d) => ({
          key: `db-here:${d.path}`,
          label: `#${d.tag} in this project`,
          hint: `${d.inThisProject!.count} ${d.inThisProject!.count === 1 ? "note" : "notes"}`,
          icon: "icon:database",
          onPick: () => pick(target(d.path, d.inThisProject!.view)),
        }));
  const name = query.trim();
  const tag = tagFrom(name);
  const create: MenuItem[] =
    view && tag && links.createDatabase && !all.some((d) => d.tag.toLowerCase() === tag)
      ? [
          {
            key: "create",
            label: `New database “${name}”`,
            hint: `#${tag}`,
            icon: "icon:plus",
            onPick: () => pick(links.createDatabase!(name, view).then((made) => made && target(made.path, made.view))),
          },
        ]
      : [];
  return [{ items: create }, ...(here.length > 0 ? [{ title: "In this project", items: here }] : []), { title: view ? `Show a database as a ${VIEW_NAMES[view].toLowerCase()}` : "Show a tag database", items }];
}
