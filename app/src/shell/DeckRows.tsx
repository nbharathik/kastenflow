import { memo } from "react";

import { useDecks } from "../features/slides/store";
import { dragNotes } from "../features/workspace/drag";
import { howFromPage } from "../features/workspace/open-how";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { Menu, openRowMenu } from "./Menu";
import { openItems, openMenuHandlers } from "./open-menu";
import { ShowMoreRow, useRowLimit } from "./row-limit";
import { keeps, useTreeFilter } from "./tree-filter";
import { Icon } from "../ui/Icon";
import { IconOrEmoji } from "../ui/IconOrEmoji";
import { lineIcon } from "../ui/glyph";

/** A deck in the sidebar: under its project, or in Favourites. */
export const DeckRow = memo(function DeckRow({ path, title, depth = 0 }: { path: string; title: string; depth?: number }) {
  const active = useWorkspace((s) => s.place.view === "slides" && s.place.path === path);
  const favourite = usePrefs((s) => s.favourites.includes(path));
  const filter = useTreeFilter();
  const { openPath, trash } = useWorkspace.getState();
  if (!keeps(filter, path)) return null;
  return (
    <li>
      <div
        draggable
        onDragStart={(e) => dragNotes(e, [path])}
        onContextMenu={openRowMenu}
        className={`group flex h-7 items-center gap-1 rounded-md pr-1 text-13 transition-colors ${active ? "bg-selected font-medium" : "hover:bg-hover"}`}
        style={{ paddingLeft: `${4 + depth * 14}px` }}
      >
        <span className="size-5 shrink-0" aria-hidden="true" />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={(e) => openPath(path, howFromPage(e))}
          onAuxClick={openMenuHandlers(path).onAuxClick}
          aria-current={active ? "page" : undefined}
          title={`${title} (deck)`}
        >
          <span className="grid w-5 shrink-0 place-items-center text-16 leading-none" aria-hidden="true">
            <IconOrEmoji icon={lineIcon("present")} />
          </span>
          <span className="truncate">{title}</span>
        </button>
        <span className="hidden items-center group-focus-within:flex group-hover:flex">
          <Menu
            label={`More for ${title}`}
            float
            align="left"
            buttonClass="grid size-5 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
            items={[
              { label: favourite ? "Remove from Favourites" : "Add to Favourites", icon: <Icon name="star" className="size-4" />, onSelect: () => usePrefs.getState().toggleFavourite(path) },
              "divider",
              ...openItems(path),
              "divider",
              { label: "Move to Trash", icon: <Icon name="trash" className="size-4" />, danger: true, onSelect: () => void trash(path) },
            ]}
          >
            <Icon name="more" className="size-4" />
          </Menu>
        </span>
      </div>
    </li>
  );
});

/** A project's decks, listed after its whiteboards; the first few, then "Show more". */
export function ProjectDecks({ project, depth }: { project: string; depth: number }) {
  const decks = useDecks((s) => s.list);
  const filter = useTreeFilter();
  const [limit, more] = useRowLimit(`${project}:decks`);
  const mine = decks.filter((d) => d.project === project && keeps(filter, d.path));
  const cut = !filter && mine.length > limit;
  return (
    <>
      {(cut ? mine.slice(0, limit) : mine).map((d) => (
        <DeckRow key={d.path} path={d.path} title={d.title} depth={depth} />
      ))}
      {cut && <ShowMoreRow shown={limit} total={mine.length} depth={depth} onMore={more} />}
    </>
  );
}

/** Favourite decks, by the order they were starred. */
export function FavouriteDecks({ paths }: { paths: readonly string[] }) {
  const decks = useDecks((s) => s.list);
  return paths.map((path) => {
    const deck = decks.find((d) => d.path === path);
    return deck ? <DeckRow key={path} path={path} title={deck.title} /> : null;
  });
}
