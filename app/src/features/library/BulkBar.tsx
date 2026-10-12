import "../pages/editor/styles/tokens.css";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { BoardInfo } from "../../lib/vault/types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Icon } from "../../ui/Icon";
import { iconOf, titleOf } from "../workspace/names";
import { useWorkspace } from "../workspace/store";
import { MAX_STACK } from "../workspace/store-layout";
import { projects } from "../workspace/tree";
import { addTag, addToBoard, announce, cleanTag, moveTo, removeTag, sharedProject, trashAll, type BulkDeps, type Done } from "./bulk";
import { PAGES, type Row, type TagCount } from "./filters";
import { Glyph, cards, tagSwatch } from "./parts";
import { Picker } from "./Picker";
import { lineIcon } from "../../ui/glyph";

type Menu = "tag" | "untag" | "move" | "board";

export interface BulkBarProps {
  /** The selected rows, in the order shown. */
  rows: readonly Row[];
  /** How many cards match in all, for "Select all". */
  shown: number;
  tags: readonly TagCount[];
  /** Tag schema colours, by lower-case tag. */
  tagColors: Record<string, string>;
  onSelectAll(): void;
  onClear(): void;
  /** After an action: the selection goes and the counts reload. */
  onDone(): void;
}

/** Trashing more than this many asks first. */
const ASK_OVER = 5;
/** Room for each toast under the bar, so neither hides the other. */
const TOAST_ROOM = 44;

/** Floats at the bottom while cards are selected: tag, move, add to a board
 * or trash them all. Esc clears the selection. */
export function BulkBar({ rows, shown, tags, tagColors, onSelectAll, onClear, onDone }: BulkBarProps) {
  const notes = useWorkspace((s) => s.notes);
  const toasts = useWorkspace((s) => s.toasts.length);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const paths = rows.map((r) => r.path);

  // Esc drops the selection; an open menu or dialog takes Esc first.
  useEffect(() => {
    if (menu || asking || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, asking, busy, onClear]);

  function open(next: Menu) {
    if (menu === next) return setMenu(null);
    setMenu(next);
    if (next !== "board") return;
    setBoards(null);
    useWorkspace
      .getState()
      .client?.boards()
      .then(setBoards, () => setBoards([]));
  }

  /** Runs one action on every selected note, showing progress, then its summary. */
  async function run(verb: string, action: (deps: BulkDeps) => Promise<Done>) {
    const workspace = useWorkspace.getState();
    if (!workspace.client) return;
    setMenu(null);
    setAsking(false);
    setBusy(`${verb}…`);
    const deps: BulkDeps = {
      client: workspace.client,
      notes: () => useWorkspace.getState().notes,
      noteChanged: workspace.noteChanged,
      refresh: workspace.refresh,
      move: (path, project) => workspace.move(path, project, true),
      trash: (path) => workspace.trash(path, true),
      progress: (done, total) => total > 1 && setBusy(`${verb} ${done} of ${total}…`),
    };
    try {
      announce(await action(deps), useWorkspace.getState().toast);
      onDone();
    } catch (err) {
      // The selection stays, so the action can be tried again.
      useWorkspace.getState().toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  // The tags the selected cards carry, most used first, for Remove tag.
  const picked = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) for (const tag of row.note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const projectNotes = useMemo(() => projects(notes), [notes]);
  const projectTitle = (folder: string | null) => {
    const project = folder ? projectNotes.find((p) => p.project === folder) : undefined;
    return project ? titleOf(project) : (folder ?? "Pages");
  };
  const places = [
    { key: PAGES, label: "Pages", detail: "No project", icon: lineIcon("page") },
    ...projectNotes.map((p) => ({ key: p.project!, label: titleOf(p), icon: iconOf(p) })),
  ];

  return (
    <div
      className="pointer-events-none sticky bottom-0 z-30 mt-auto flex justify-center px-4 pt-3 transition-[padding]"
      style={{ paddingBottom: 20 + toasts * TOAST_ROOM }}
    >
      <div
        ref={bar}
        role="toolbar"
        aria-label="Selected cards"
        className="pointer-events-auto relative flex max-w-full flex-wrap items-center gap-0.5 rounded-2xl bg-(--notion-menu-bg) p-1.5 text-13 text-ink shadow-(--notion-shadow) transition starting:translate-y-2 starting:opacity-0"
      >
        <span className="px-2.5 font-medium tabular-nums" aria-live="polite">
          {busy ?? `${rows.length} selected`}
        </span>
        {!busy && rows.length < shown && (
          <button type="button" onClick={onSelectAll} className="h-8 rounded-lg px-2 text-accent outline-none transition-colors hover:bg-(--notion-hover) focus-visible:ring-2 focus-visible:ring-accent/50">
            Select all {shown.toLocaleString()}
          </button>
        )}
        <Divider />
        <span className="relative">
          <BarButton icon={<Icon name="tag" className="size-4 text-muted" />} open={menu === "tag"} disabled={Boolean(busy)} onClick={() => open("tag")}>
            Add tag…
          </BarButton>
          {menu === "tag" && (
            <Picker
              label="Add tag"
              placeholder="Find or type a tag…"
              options={tags.map((t) => ({
                key: t.label,
                label: `#${t.label}`,
                detail: String(t.count),
                icon: <span className="block size-2 rounded-full" style={{ background: tagSwatch(tagColors[t.tag])?.fg ?? "var(--notion-gray)" }} />,
              }))}
              onPick={(tag) => void run("Tagging", (d) => addTag(d, paths, tag))}
              create={{
                label: (text) => {
                  const tag = cleanTag(text);
                  return tag && !tags.some((t) => t.tag === tag.toLowerCase()) ? `Add #${tag}` : null;
                },
                run: (text) => void run("Tagging", (d) => addTag(d, paths, cleanTag(text)!)),
              }}
              empty="A tag has letters, digits, - _ or /"
              within={bar}
              onClose={() => setMenu(null)}
            />
          )}
        </span>
        {picked.length > 0 && (
          <span className="relative">
            <BarButton icon={<Icon name="remove" className="size-4 text-muted" />} open={menu === "untag"} disabled={Boolean(busy)} onClick={() => open("untag")}>
              Remove tag…
            </BarButton>
            {menu === "untag" && (
              <Picker
                label="Remove tag"
                placeholder="Find a tag…"
                options={picked.map(([tag, count]) => ({ key: tag, label: `#${tag}`, detail: `${count} of ${rows.length}` }))}
                onPick={(tag) => void run("Untagging", (d) => removeTag(d, paths, tag))}
                empty="No tag matches"
                within={bar}
                onClose={() => setMenu(null)}
              />
            )}
          </span>
        )}
        <span className="relative">
          <BarButton icon={<Glyph name="move" className="size-4 text-muted" />} open={menu === "move"} disabled={Boolean(busy)} onClick={() => open("move")}>
            Move to…
          </BarButton>
          {menu === "move" && (
            <Picker
              label="Move to"
              placeholder="Move to a project…"
              options={places}
              onPick={(key) => void run("Moving", (d) => moveTo(d, paths, key === PAGES ? null : key, key === PAGES ? "Pages" : projectTitle(key)))}
              empty="No project matches"
              within={bar}
              onClose={() => setMenu(null)}
            />
          )}
        </span>
        <span className="relative">
          <BarButton icon={<Icon name="board" className="size-4 text-muted" />} open={menu === "board"} disabled={Boolean(busy)} onClick={() => open("board")}>
            Add to board…
          </BarButton>
          {menu === "board" && (
            <Picker
              label="Add to board"
              placeholder="Find a board…"
              options={boards?.map((b) => ({ key: b.path, label: b.title, detail: projectTitle(b.project), icon: <Icon name="board" className="size-4 text-muted" /> })) ?? null}
              onPick={(path) => void run("Adding", (d) => addToBoard(d, paths, { path, title: boards?.find((b) => b.path === path)?.title ?? path }))}
              create={{
                label: (text) => (text ? `New board “${text}”` : "New board…"),
                prompt: "Name the new board, then Enter",
                run: (title) =>
                  void run("Adding", async (d) => {
                    const path = await d.client.createBoard(title, sharedProject(rows.map((r) => r.note)));
                    return addToBoard(d, paths, { path, title });
                  }),
              }}
              empty="No boards yet"
              within={bar}
              onClose={() => setMenu(null)}
            />
          )}
        </span>
        <BarButton
          icon={<Icon name="stack" className="size-4 text-muted" />}
          disabled={Boolean(busy)}
          onClick={() => {
            // Heptabase's way to read several at once: side by side, first on top.
            useWorkspace.getState().stackAll(paths);
            const shown = Math.min(paths.length, MAX_STACK);
            useWorkspace.getState().toast(paths.length > MAX_STACK ? `Opened the first ${shown} in the side stack` : `Opened ${shown} in the side stack`);
          }}
        >
          Open side by side
        </BarButton>
        <BarButton
          icon={<Icon name="layers" className="size-4 text-muted" />}
          disabled={Boolean(busy)}
          onClick={() => {
            useWorkspace.getState().openTabs(paths.map((path) => ({ view: "page" as const, path })));
            useWorkspace.getState().toast(`Opened ${paths.length} in tabs`);
          }}
        >
          Open in tabs
        </BarButton>
        <Divider />
        <BarButton
          icon={<Icon name="trash" className="size-4" />}
          danger
          disabled={Boolean(busy)}
          onClick={() => (rows.length > ASK_OVER ? setAsking(true) : void run("Trashing", (d) => trashAll(d, paths)))}
        >
          Trash
        </BarButton>
        <button
          type="button"
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          disabled={Boolean(busy)}
          onClick={onClear}
          className="grid size-8 place-items-center rounded-lg text-muted outline-none transition-colors hover:bg-(--notion-hover) hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40"
        >
          <Glyph name="close" className="size-4" />
        </button>
      </div>
      {asking && <ConfirmTrash count={rows.length} onCancel={() => setAsking(false)} onConfirm={() => void run("Trashing", (d) => trashAll(d, paths))} />}
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />;
}

function BarButton({ icon, open, danger, disabled, onClick, children }: { icon: ReactNode; open?: boolean; danger?: boolean; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-haspopup={open === undefined ? undefined : "dialog"}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 ${
        open ? "bg-(--notion-hover)" : danger ? "text-danger hover:bg-danger/10" : "hover:bg-(--notion-hover)"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/** "Move 12 cards to the trash?" before trashing more than five. */
function ConfirmTrash({ count, onCancel, onConfirm }: { count: number; onCancel(): void; onConfirm(): void }) {
  return (
    <ConfirmDialog title={`Move ${cards(count)} to the trash?`} confirm="Move to trash" danger alert onConfirm={onConfirm} onClose={onCancel}>
      They go to the vault's .trash folder with their paths kept, and each one can come back from Trash.
    </ConfirmDialog>
  );
}
