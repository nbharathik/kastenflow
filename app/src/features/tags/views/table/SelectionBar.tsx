// The bar that floats at the bottom of a table while rows are picked: set a
// property, add or remove a tag, move to a project, add to a board, duplicate,
// trash. Each action that a batch can carry is ONE batch: one commit, one
// Undo in the notice. Duplicate and Trash go row by row (each its own core
// op) with one notice and one Undo for all. More than five rows ask first,
// for trash only.

import "../../../pages/editor/styles/tokens.css";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { BoardInfo, NoteMeta, PropDef } from "../../../../lib/vault/types";
import { ConfirmDialog } from "../../../../ui/ConfirmDialog";
import { Icon } from "../../../../ui/Icon";
import { lineIcon } from "../../../../ui/glyph";
import { cleanTag, trashAll, type Done } from "../../../library/bulk";
import { PAGES } from "../../../library/filters";
import { Picker } from "../../../library/Picker";
import { iconOf, titleOf } from "../../../workspace/names";
import { useWorkspace } from "../../../workspace/store";
import { projects } from "../../../workspace/tree";
import { addToBoardChanges, moveChanges, removeTagChanges, setPropertyChanges, tagChanges, tooMany, type Planned } from "./bulk-changes";
import { announce, bulkDeps, duplicateRows } from "./bulk-extra";
import { runAndTell } from "./bulk-run";
import { SetProperty, settable } from "./SetProperty";

type Menu = "set" | "tag" | "untag" | "move" | "board";

export interface SelectionBarProps {
  /** The picked rows, in the order shown. */
  rows: readonly NoteMeta[];
  /** How many rows the table has, for "Select all". */
  shown: number;
  properties: readonly PropDef[];
  onSelectAll(): void;
  onClear(): void;
  /** Keeps only the first `n` picked rows. */
  onKeepFirst(n: number): void;
}

const ASK_OVER = 5;
const TOAST_ROOM = 44;
const KEEP = 100;
const rowsWord = (n: number) => `${n.toLocaleString()} ${n === 1 ? "row" : "rows"}`;

export function SelectionBar({ rows, shown, properties, onSelectAll, onClear, onKeepFirst }: SelectionBarProps) {
  const notes = useWorkspace((s) => s.notes);
  const toasts = useWorkspace((s) => s.toasts.length);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const paths = rows.map((r) => r.path);

  // Escape drops the selection; an open menu or dialog takes Escape first.
  useEffect(() => {
    if (menu || asking || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, asking, busy, onClear]);

  const tags = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const n of notes) {
      for (const t of n.tags) {
        const seen = counts.get(t.toLowerCase());
        if (seen) seen.count++;
        else counts.set(t.toLowerCase(), { label: t, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [notes]);
  const picked = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) for (const t of row.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const projectNotes = useMemo(() => projects(notes), [notes]);
  const places = [{ key: PAGES, label: "Pages", detail: "No project", icon: lineIcon("page") }, ...projectNotes.map((p) => ({ key: p.project!, label: titleOf(p), icon: iconOf(p) }))];

  function open(next: Menu) {
    if (menu === next) return setMenu(null);
    setMenu(next);
    if (next !== "board") return;
    setBoards(null);
    void useWorkspace
      .getState()
      .client?.boards()
      .then(setBoards, () => setBoards([]));
  }

  /** One batch for the plan; the selection goes when the rows have left the table's business. */
  async function apply(verb: string, planned: Planned, reason: string, done: string, undone: string, clear: boolean) {
    setMenu(null);
    const toast = useWorkspace.getState().toast;
    const big = tooMany(planned.changes.length);
    if (big) return toast(big, { label: `Keep the first ${KEEP}`, run: () => onKeepFirst(KEEP) });
    if (planned.changes.length === 0) return toast("Nothing to change: the picked rows are already like that.");
    setBusy(`${verb}…`);
    const ok = await runAndTell(planned.changes, reason, paths, done + (planned.skipped > 0 ? ` (${planned.skipped} already were)` : ""), undone);
    setBusy(null);
    if (ok && clear) onClear();
  }

  /** Duplicate and Trash: row by row, with progress, one notice and one Undo. */
  async function rowByRow(verb: string, action: (deps: NonNullable<ReturnType<typeof bulkDeps>>) => Promise<Done>) {
    setMenu(null);
    setAsking(false);
    setBusy(`${verb}…`);
    const deps = bulkDeps((done, total) => total > 1 && setBusy(`${verb} ${done} of ${total}…`));
    try {
      if (!deps) return;
      announce(await action(deps), useWorkspace.getState().toast);
      onClear();
    } catch (err) {
      useWorkspace.getState().toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const n = rows.length;
  return (
    <div className="kasten-table-bulk">
      <div className="pointer-events-none flex w-full justify-center px-4" style={{ paddingBottom: toasts * TOAST_ROOM }}>
        <div
          ref={bar}
          role="toolbar"
          aria-label="Selected rows"
          className="pointer-events-auto relative flex max-w-full flex-wrap items-center gap-0.5 rounded-2xl bg-(--notion-menu-bg) p-1.5 text-13 text-ink shadow-(--notion-shadow) transition starting:translate-y-2 starting:opacity-0"
        >
          <span className="px-2.5 font-medium tabular-nums" aria-live="polite">
            {busy ?? `${n.toLocaleString()} selected`}
          </span>
          {!busy && n < shown && (
            <button type="button" onClick={onSelectAll} className="h-8 rounded-lg px-2 text-accent outline-none transition-colors hover:bg-(--notion-hover) focus-visible:ring-2 focus-visible:ring-accent/50">
              Select all {shown.toLocaleString()}
            </button>
          )}
          <Divider />
          {settable(properties).length > 0 && (
            <span className="relative">
              <BarButton icon={<Icon name="edit" className="size-4 text-muted" />} open={menu === "set"} disabled={Boolean(busy)} onClick={() => open("set")}>
                Set property…
              </BarButton>
              {menu === "set" && (
                <SetProperty
                  properties={settable(properties)}
                  within={bar}
                  onClose={() => setMenu(null)}
                  onSet={(def, value, said) =>
                    void apply("Changing", setPropertyChanges(rows, def.key, value), `Set ${def.key} on ${rowsWord(n)}`, value === null ? `Cleared ${def.key} on ${rowsWord(n)}` : `Set ${def.key} to ${said} on ${rowsWord(n)}`, `Took back the change to ${def.key}`, false)
                  }
                />
              )}
            </span>
          )}
          <span className="relative">
            <BarButton icon={<Icon name="tag" className="size-4 text-muted" />} open={menu === "tag"} disabled={Boolean(busy)} onClick={() => open("tag")}>
              Add tag…
            </BarButton>
            {menu === "tag" && (
              <Picker
                label="Add tag"
                placeholder="Find or type a tag…"
                options={tags.map((t) => ({ key: t.label, label: `#${t.label}`, detail: String(t.count) }))}
                onPick={(tag) => void apply("Tagging", tagChanges(rows, tag), `Add #${tag} to ${rowsWord(n)}`, `Tagged ${rowsWord(n)} #${tag}`, `Took back the tag #${tag}`, false)}
                create={{
                  label: (text) => {
                    const tag = cleanTag(text);
                    return tag && !tags.some((t) => t.label.toLowerCase() === tag.toLowerCase()) ? `Add #${tag}` : null;
                  },
                  run: (text) => {
                    const tag = cleanTag(text)!;
                    void apply("Tagging", tagChanges(rows, tag), `Add #${tag} to ${rowsWord(n)}`, `Tagged ${rowsWord(n)} #${tag}`, `Took back the tag #${tag}`, false);
                  },
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
                  options={picked.map(([tag, count]) => ({ key: tag, label: `#${tag}`, detail: `${count} of ${n}` }))}
                  onPick={(tag) => void apply("Untagging", removeTagChanges(rows, tag), `Remove #${tag} from ${rowsWord(n)}`, `Took #${tag} off ${rowsWord(n)}`, `Put the tag #${tag} back`, false)}
                  empty="No tag matches"
                  within={bar}
                  onClose={() => setMenu(null)}
                />
              )}
            </span>
          )}
          <span className="relative">
            <BarButton icon={<Icon name="folder" className="size-4 text-muted" />} open={menu === "move"} disabled={Boolean(busy)} onClick={() => open("move")}>
              Move to…
            </BarButton>
            {menu === "move" && (
              <Picker
                label="Move to"
                placeholder="Move to a project…"
                options={places}
                onPick={(key) => {
                  const where = key === PAGES ? "Pages" : titleOf(projectNotes.find((p) => p.project === key) ?? ({ title: key, path: key } as NoteMeta));
                  void apply("Moving", moveChanges(rows, notes, key === PAGES ? null : key), `Move ${rowsWord(n)} to ${where}`, `Moved ${rowsWord(n)} to ${where}`, "Moved them back", true);
                }}
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
                options={boards?.map((b) => ({ key: b.path, label: b.title, icon: <Icon name="board" className="size-4 text-muted" /> })) ?? null}
                onPick={(path) => {
                  const title = boards?.find((b) => b.path === path)?.title ?? path;
                  void apply("Adding", { changes: addToBoardChanges(path, rows), skipped: 0 }, `Add ${rowsWord(n)} to ${title}`, `Added ${rowsWord(n)} to “${title}”`, `Took them off “${title}”`, true);
                }}
                empty="No boards yet. Make one from the Boards page."
                within={bar}
                onClose={() => setMenu(null)}
              />
            )}
          </span>
          <BarButton icon={<Icon name="copy" className="size-4 text-muted" />} disabled={Boolean(busy)} onClick={() => void rowByRow("Duplicating", (d) => duplicateRows(d, rows))}>
            Duplicate
          </BarButton>
          <Divider />
          <BarButton icon={<Icon name="trash" className="size-4" />} danger disabled={Boolean(busy)} onClick={() => (n > ASK_OVER ? setAsking(true) : void rowByRow("Trashing", (d) => trashAll(d, paths)))}>
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
            <Icon name="close" className="size-4" />
          </button>
        </div>
      </div>
      {asking && (
        <ConfirmDialog title={`Move ${rowsWord(n)} to the trash?`} confirm="Move to trash" danger alert onConfirm={() => void rowByRow("Trashing", (d) => trashAll(d, paths))} onClose={() => setAsking(false)}>
          They go to the vault's .trash folder with their paths kept, and each one can come back from Trash.
        </ConfirmDialog>
      )}
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
