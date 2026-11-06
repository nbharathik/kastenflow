import { memo, useRef, useState } from "react";

import { relativeTime } from "../../lib/dates";
import type { DeckInfo } from "../../lib/vault/types";
import { Menu, openRowMenu } from "../../shell/Menu";
import { Icon } from "../../ui/Icon";
import { projectTitle } from "../boards/store";
import { dragNotes } from "../workspace/drag";
import { usePrefs } from "../workspace/prefs";
import { howFrom, useWorkspace } from "../workspace/store";
import { DeckThumb } from "./DeckThumb";
import { duplicateDeck, renameDeck } from "./deck-actions";
import type { DeckView } from "./home-prefs";
import { useDeckPreview } from "./previews";
import { useDecks } from "./store";
import { useInView } from "./use-in-view";

export const slidesOf = (count: number): string => (count === 1 ? "1 slide" : `${count} slides`);

/** "edited 2 hours ago", or nothing when the file's time is not known. */
export const editedAgo = (modified: number | undefined): string => (typeof modified === "number" ? `edited ${relativeTime(modified)}` : "");

/** A card of the deck's first slide, drawn only while the card is near the window. */
export function CardThumb({ info }: { info: DeckInfo }) {
  const box = useRef<HTMLDivElement>(null);
  const near = useInView(box);
  // The file is read once the card has been near; the picture is drawn only while it is, so a long list holds few slides at a time.
  const [seen, setSeen] = useState(false);
  if (near && !seen) setSeen(true);
  const deck = useDeckPreview(info, seen);
  return (
    <div ref={box} data-thumb={near ? "drawn" : "waiting"} className="aspect-video overflow-hidden rounded-md border border-line bg-well shadow-card">
      {near ? <DeckThumb deck={deck} /> : null}
    </div>
  );
}

/**
 * One deck on the Slides home: its first slide, name, slide count and when it was edited. A grid card or a list row (`view`). The
 * arrows move between cards (`tabbable` is the one in the Tab order), Enter opens, and right-click or the context-menu key opens
 * Open, Rename, Duplicate and Move to Trash. Nothing here deletes for good.
 */
export const DeckCard = memo(function DeckCard({ info, view, tabbable, onFocusCard }: { info: DeckInfo; view: DeckView; tabbable: boolean; onFocusCard(path: string): void }) {
  const favourite = usePrefs((s) => s.favourites.includes(info.path));
  const project = useWorkspace((s) => (info.project ? projectTitle(s.notes, info.project) : null));
  const [naming, setNaming] = useState<string | null>(null);
  const { openPath, trash, toast } = useWorkspace.getState();
  const tab = tabbable ? 0 : -1;

  const run = (job: Promise<unknown>, done?: () => void) =>
    void job.then(
      () => {
        void useDecks.getState().load();
        done?.();
      },
      (error: unknown) => toast(error instanceof Error ? error.message : String(error)),
    );
  // A name is settled once: Enter, Escape and the box going away (which may blur it) must not each act on it.
  const settled = useRef(true);
  const startNaming = () => {
    settled.current = false;
    setNaming(info.title);
  };
  const cancel = () => {
    settled.current = true;
    setNaming(null);
  };
  const rename = () => {
    if (settled.current) return;
    settled.current = true;
    const title = naming;
    setNaming(null);
    const client = useWorkspace.getState().client;
    if (client && title !== null && title.trim() && title.trim() !== info.title) run(renameDeck(client, info.path, title));
  };
  const copy = () => {
    const client = useWorkspace.getState().client;
    if (!client) return;
    const title = `${info.title} copy`;
    run(duplicateDeck(client, info.path, title, info.project), () => toast(`Made “${title}”`));
  };

  const meta = info.problem ? <span className="text-danger">Cannot be read</span> : [slidesOf(info.slides), editedAgo(info.modified)].filter(Boolean).join(" · ");
  return (
    <div
      draggable
      data-card={info.path}
      data-view={view}
      onDragStart={(e) => dragNotes(e, [info.path])}
      onContextMenu={openRowMenu}
      className="sh-card group relative rounded-xl border border-line bg-canvas shadow-card transition ease-standard hover:border-line-hover hover:shadow-hover motion-reduce:transition-none"
    >
      <button
        type="button"
        data-deck-card=""
        tabIndex={tab}
        aria-label={`Open ${info.title}`}
        onFocus={() => onFocusCard(info.path)}
        onClick={(e) => openPath(info.path, howFrom(e))}
        onAuxClick={(e) => e.button === 1 && openPath(info.path, "tab")}
        className="sh-main block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="sh-thumb block border-line bg-panel/70 p-3">
          <CardThumb info={info} />
        </span>
        {naming === null && (
          <span className="sh-text block px-3.5 pb-3 pt-2.5">
            <span className="block truncate text-14 font-semibold">{info.title}</span>
            <span className="mt-0.5 block truncate text-12 text-muted">
              {meta}
              {project ? ` · ${project}` : ""}
            </span>
          </span>
        )}
      </button>
      {naming !== null && (
        <input
          autoFocus
          aria-label={`Name of ${info.title}`}
          value={naming}
          onChange={(e) => setNaming(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === "Enter") rename();
            else if (e.key === "Escape") cancel();
          }}
          className="sh-name h-8 rounded-md border border-line bg-canvas px-2 text-14 font-semibold outline-none focus:border-accent/60"
        />
      )}
      <div className="sh-actions absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-canvas p-0.5 opacity-0 shadow-card transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 data-[on=true]:opacity-100" data-on={favourite}>
        <button
          type="button"
          tabIndex={tab}
          aria-label={favourite ? `Remove ${info.title} from Favourites` : `Add ${info.title} to Favourites`}
          title={favourite ? "Remove from Favourites" : "Add to Favourites"}
          onClick={() => usePrefs.getState().toggleFavourite(info.path)}
          className={`grid size-6 place-items-center rounded-md hover:bg-hover ${favourite ? "text-favourite" : "text-muted"}`}
        >
          <Icon name="star" className={`size-4 ${favourite ? "fill-current" : ""}`} />
        </button>
        <Menu
          label={`More for ${info.title}`}
          buttonTabIndex={tab}
          buttonClass="grid size-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
          items={[
            { label: "Open", icon: <Icon name="present" className="size-4" />, onSelect: () => openPath(info.path, "here") },
            { label: "Open in new tab", icon: <Icon name="external" className="size-4" />, hint: "Ctrl+click", onSelect: () => openPath(info.path, "tab") },
            "divider",
            { label: "Rename", icon: <Icon name="edit" className="size-4" />, onSelect: startNaming },
            { label: "Duplicate", icon: <Icon name="copy" className="size-4" />, onSelect: copy },
            "divider",
            { label: "Move to Trash", icon: <Icon name="trash" className="size-4" />, danger: true, onSelect: () => void trash(info.path) },
          ]}
        >
          <Icon name="more" className="size-4" />
        </Menu>
      </div>
    </div>
  );
});
