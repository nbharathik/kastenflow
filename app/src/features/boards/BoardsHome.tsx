import { memo, useEffect, useMemo, useState } from "react";

import { relativeTime } from "../../lib/dates";
import type { BoardInfo, NoteMeta } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { Menu } from "../../shell/Menu";
import { dragNotes } from "../workspace/drag";
import { usePrefs } from "../workspace/prefs";
import { howFrom, useWorkspace } from "../workspace/store";
import { BoardThumb } from "./BoardThumb";
import { NewBoard } from "./NewBoard";
import { usePreview } from "./previews";
import { projectTitle, useBoards } from "./store";

interface Group {
  key: string;
  title: string;
  boards: BoardInfo[];
}

/** Boards by project (projects by title, loose boards last), newest first. */
function groups(boards: readonly BoardInfo[], notes: readonly NoteMeta[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const board of boards) {
    const key = board.project ?? "";
    let group = byKey.get(key);
    if (!group) byKey.set(key, (group = { key, title: key ? projectTitle(notes, key) : "Not in a project", boards: [] }));
    group.boards.push(board);
  }
  for (const group of byKey.values()) group.boards.sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title));
  return [...byKey.values()].sort((a, b) => (a.key === "") !== (b.key === "") ? (a.key === "" ? 1 : -1) : a.title.localeCompare(b.title));
}

/** The Whiteboards view: every board as a card with
 * a sketch of what is on it, by project, and a way to start a new one. */
export function BoardsHome() {
  const list = useBoards((s) => s.list);
  const loaded = useBoards((s) => s.loaded);
  const creating = useBoards((s) => s.creating);
  const draftProject = useBoards((s) => s.draftProject);
  const notes = useWorkspace((s) => s.notes);
  const [query, setQuery] = useState("");
  // A project's home can ask for its boards only; the view takes that once, then clears it.
  const [only, setOnly] = useState(() => useBoards.getState().onlyProject);
  useEffect(() => void useBoards.getState().load(), []);
  useEffect(() => void useBoards.setState({ onlyProject: null }), []);

  const words = query.trim().toLowerCase();
  const shown = useMemo(() => list.filter((b) => (!only || b.project === only) && (!words || b.title.toLowerCase().includes(words))), [list, words, only]);
  const sections = useMemo(() => groups(shown, notes), [shown, notes]);
  const start = () => useBoards.setState({ creating: true, draftProject: null });

  return (
    <div className="mx-auto max-w-[1120px] px-6 pb-24 pt-10">
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-[240px] flex-1">
          <h1 className="text-28 font-bold tracking-tight">
            <Icon name="board" className="mr-2.5 inline size-[26px] align-[-4px] text-muted" />
            Whiteboards
          </h1>
          <p className="mt-1 text-14 text-muted">Lay out cards, connect them and think in space. One card can sit on many boards.</p>
        </div>
        {list.length > 0 && (
          <label className="flex h-9 w-60 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-muted transition focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/15">
            <Icon name="search" />
            <input type="search" aria-label="Find a whiteboard" placeholder="Find a whiteboard" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-13 text-ink outline-none" />
          </label>
        )}
        <button type="button" onClick={start} className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-13 font-medium text-on-accent shadow-card transition hover:brightness-110">
          <Icon name="plus" className="size-4" />
          New whiteboard
        </button>
      </header>

      {only && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-13 text-muted">
          <span>Only the boards of {projectTitle(notes, only)}.</span>
          <button type="button" onClick={() => setOnly(null)} className="rounded px-1.5 py-0.5 text-accent hover:bg-hover">
            Show every project
          </button>
        </p>
      )}

      {creating && <NewBoard key={draftProject ?? ""} />}

      {loaded && list.length === 0 && !creating && (
        <div className="mt-16 grid place-items-center text-center">
<div className="mx-auto grid size-14 place-items-center rounded-2xl bg-panel text-muted" aria-hidden="true">
            <Icon name="board" className="size-7" />
          </div>
          <h2 className="mt-3 text-20 font-semibold">No whiteboards yet</h2>
          <p className="mt-1 max-w-[420px] text-14 text-muted">A whiteboard is an open space for your cards: drag notes onto it, group them into sections and draw connections between ideas.</p>
          <button type="button" onClick={start} className="mt-5 h-9 rounded-lg bg-accent px-4 text-13 font-medium text-on-accent shadow-card hover:brightness-110">
            Make your first whiteboard
          </button>
        </div>
      )}

      {words && shown.length === 0 && <p className="mt-10 text-center text-14 text-muted">No whiteboard is called “{query.trim()}”.</p>}

      {sections.map((group) => (
        <section key={group.key} aria-label={group.title} className="mt-9">
          <h2 className="mb-3 flex items-center gap-2 text-12 font-medium text-muted">
            {group.title}
            <span className="rounded bg-well px-1.5 text-11 font-medium normal-case tracking-normal text-muted">{group.boards.length}</span>
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(228px,1fr))] gap-4">
            {group.boards.map((board) => (
              <BoardTile key={board.path} info={board} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const BoardTile = memo(function BoardTile({ info }: { info: BoardInfo }) {
  const board = usePreview(info);
  const favourite = usePrefs((s) => s.favourites.includes(info.path));
  const { openPath, trash } = useWorkspace.getState();
  const things = info.nodes === 1 ? "1 thing" : `${info.nodes} things`;
  return (
    <div
      draggable
      onDragStart={(e) => dragNotes(e, [info.path])}
      className="group relative overflow-hidden rounded-xl border border-line bg-canvas shadow-card transition ease-standard hover:border-line-hover hover:shadow-hover motion-reduce:transition-none"
    >
      <button type="button" aria-label={`Open ${info.title}`} onClick={(e) => openPath(info.path, howFrom(e))} onAuxClick={(e) => e.button === 1 && openPath(info.path, "tab")} className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <div className="h-[136px] border-b border-line bg-panel/70 p-3 [background-image:radial-gradient(var(--color-line)_1px,transparent_1px)] [background-size:14px_14px]">
          <BoardThumb board={board} />
        </div>
        <div className="px-3.5 pb-3 pt-2.5">
          <div className="truncate text-14 font-semibold">{info.title}</div>
          <div className="mt-0.5 text-12 text-muted">
            {things} · {relativeTime(info.modified)}
          </div>
        </div>
      </button>
      <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-canvas p-0.5 opacity-0 shadow-card transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 data-[on=true]:opacity-100" data-on={favourite}>
        <button
          type="button"
          aria-label={favourite ? `Remove ${info.title} from Favourites` : `Add ${info.title} to Favourites`}
          title={favourite ? "Remove from Favourites" : "Add to Favourites"}
          onClick={() => usePrefs.getState().toggleFavourite(info.path)}
          className={`grid size-6 place-items-center rounded-md hover:bg-hover ${favourite ? "text-favourite" : "text-muted"}`}
        >
          <Icon name="star" className={`size-4 ${favourite ? "fill-current" : ""}`} />
        </button>
        <Menu
          label={`More for ${info.title}`}
          buttonClass="grid size-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
          items={[
            { label: "Open in new tab", icon: <Icon name="external" className="size-4" />, hint: "Ctrl+click", onSelect: () => openPath(info.path, "tab") },
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
