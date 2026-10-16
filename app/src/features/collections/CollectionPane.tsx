// One collection, open: its name and what it finds, the notes it found as a
// table, a list or a gallery with the selected one previewed beside them, and
// the actions on the notes ticked. The list keeps its place (the note
// selected and how far it is scrolled) while a note is opened and left.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Collection } from "../../lib/vault/collection-types";
import type { PropDef } from "../../lib/vault/types";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Icon } from "../../ui/Icon";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { Menu } from "../../shell/Menu";
import { howFrom, useWorkspace } from "../workspace/store";
import { addToAiContext, peekNote } from "./actions";
import { BoardDialog } from "./BoardDialog";
import { describeDisplay, describeWhen } from "./describe";
import { PinDialog, RenameDialog } from "./Dialogs";
import { EditCollectionDialog } from "./EditDialog";
import { collectionIcon } from "./icon";
import { usePins } from "./pins";
import { movePosition, recallPosition, rememberPosition } from "./positions";
import { PreviewPane } from "./PreviewPane";
import { openCollection } from "./requests";
import { DEFAULT_COLUMNS, ResultGallery, ResultList, ResultTable, type RowsProps } from "./ResultRows";
import { useCollectionRun } from "./use-run";

type Dialog = "edit" | "rename" | "trash" | "pin" | "board" | null;

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;

export function CollectionPane({ collection }: { collection: Collection }) {
  const { run, error, schemas, loading } = useCollectionRun(collection);
  const start = useMemo(() => recallPosition(collection.path), [collection.path]);
  const [active, setActive] = useState<string | null>(start.active);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [preview, setPreview] = useState(true);
  const anchor = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const homePinned = usePins((s) => s.pins.home.includes(collection.path));

  const notes = useMemo(() => run?.notes ?? [], [run]);
  const defs = useMemo(() => new Map<string, PropDef>(schemas.flatMap((s) => s.properties).map((p) => [p.key, p] as const).reverse()), [schemas]);
  const columns = collection.display?.columns ?? [...DEFAULT_COLUMNS];
  const kind = collection.display?.type ?? "table";
  const note = notes.find((n) => n.path === active) ?? null;
  const picked = notes.filter((n) => checked.has(n.path));

  // Where the list was scrolled comes back once the notes are there.
  useEffect(() => {
    if (!run || restored.current || !scroller.current) return;
    restored.current = true;
    scroller.current.scrollTop = start.scroll;
  }, [run, start.scroll]);

  const activate = useCallback(
    (path: string) => {
      setActive(path);
      setPreview(true);
      rememberPosition(collection.path, { active: path, scroll: scroller.current?.scrollTop ?? 0 });
    },
    [collection.path],
  );
  const check = useCallback(
    (path: string, event: { shiftKey: boolean }) => {
      setChecked((was) => {
        const next = new Set(was);
        const from = anchor.current ? notes.findIndex((n) => n.path === anchor.current) : -1;
        const to = notes.findIndex((n) => n.path === path);
        if (event.shiftKey && from >= 0 && to >= 0) {
          for (const n of notes.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(n.path);
        } else if (!next.delete(path)) next.add(path);
        return next;
      });
      anchor.current = path;
    },
    [notes],
  );
  const open = useCallback((path: string, event: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    useWorkspace.getState().openPath(path, howFrom(event));
  }, []);

  const rows: RowsProps = { notes, columns, defs, active, checked, onActivate: activate, onOpen: open, onCheck: check };

  const rename = async (name: string) => {
    const client = useWorkspace.getState().client;
    if (!client) return;
    const renamed = await client.renameCollection(collection.path, name, collection.hash);
    usePins.getState().moved(collection.path, renamed.path);
    movePosition(collection.path, renamed.path);
    openCollection(renamed.path);
  };
  const trash = async () => {
    const { client, toast } = useWorkspace.getState();
    if (!client) return;
    setDialog(null);
    try {
      const trashed = await client.trashCollection(collection.path);
      usePins.getState().forget(collection.path);
      movePosition(collection.path, null);
      useWorkspace.getState().go({ view: "collections" });
      toast(`Moved the collection “${collection.name}” to the trash`, {
        label: "Undo",
        run: () => void client.restoreCollection(trashed).then((back) => openCollection(back.path), (err: unknown) => toast(err instanceof Error ? err.message : String(err))),
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  const days = describeWhen(collection.when);
  return (
    <section aria-label={collection.name} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
        <span className="text-22">
          <IconOrEmoji icon={collectionIcon(collection.icon)} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-22 font-bold tracking-tight">{collection.name}</h1>
          <p className="truncate text-13 text-muted">
            {collection.query.trim() ? <code className="rounded bg-well px-1 py-0.5 text-12">{collection.query.trim()}</code> : "Every page"}
            {days ? ` · ${days}` : ""} · shown as {describeDisplay(collection)}
          </p>
        </div>
        <Button size="sm" disabled={collection.readOnly} onClick={() => setDialog("edit")}>
          Edit
        </Button>
        <Menu
          label="More about this collection"
          items={[
            { label: "Rename…", onSelect: () => setDialog("rename") },
            homePinned ? { label: "Unpin from Home", onSelect: () => usePins.getState().unpin({ kind: "home" }, collection.path) } : { label: "Pin to Home", onSelect: () => usePins.getState().pin({ kind: "home" }, collection.path) },
            { label: "Pin to a project’s overview…", onSelect: () => setDialog("pin") },
            preview ? { label: "Hide the preview", onSelect: () => setPreview(false) } : { label: "Show the preview", onSelect: () => setPreview(true) },
            "divider",
            { label: "Move to trash", danger: true, onSelect: () => setDialog("trash") },
          ]}
          buttonClass="ui-icon-btn"
        >
          <Icon name="more" className="size-[17px]" />
        </Menu>
      </header>

      {collection.problem && (
        <p role="alert" className="border-b border-line bg-well px-6 py-3 text-13">
          This collection cannot be used: {collection.problem}. {collection.readOnly ? "Its file is left as it is." : ""}
        </p>
      )}

      {picked.length > 0 && (
        <div role="toolbar" aria-label="Notes ticked" className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-2 text-13">
          <span className="font-medium tabular-nums" aria-live="polite">
            {picked.length} ticked
          </span>
          <Button size="sm" onClick={() => picked.forEach((n) => useWorkspace.getState().openPath(n.path, "tab"))}>
            Open in tabs
          </Button>
          <Button size="sm" onClick={() => setDialog("board")}>
            Add to board…
          </Button>
          <Button size="sm" onClick={() => addToAiContext(picked)}>
            Add to AI context
          </Button>
          {picked.length === 1 && (
            <Button size="sm" onClick={() => peekNote(picked[0]!.path)}>
              Peek
            </Button>
          )}
          <Button size="sm" tone="quiet" onClick={() => setChecked(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div
          ref={scroller}
          className="min-w-0 flex-1 overflow-y-auto px-6 py-3"
          onScroll={(event) => rememberPosition(collection.path, { active, scroll: event.currentTarget.scrollTop })}
        >
          {error ? (
            <p role="alert" className="py-8 text-center text-14 text-danger">
              {error}
            </p>
          ) : collection.problem ? null : loading || !run ? (
            <p className="py-8 text-center text-14 text-muted">Looking…</p>
          ) : (
            <>
              <p className="mb-2 text-13 text-muted" aria-live="polite">
                {plural(run.total, "note")}
                {run.total > run.notes.length ? `, the first ${run.notes.length.toLocaleString()} shown` : ""}
                {run.capped ? ". The search stops at 5,000 notes" : ""}
              </p>
              {notes.length === 0 ? (
                <p className="py-10 text-center text-14 text-muted">Nothing matches yet. Edit the collection to widen it, or add notes that fit.</p>
              ) : kind === "gallery" ? (
                <ResultGallery {...rows} />
              ) : kind === "list" ? (
                <ResultList {...rows} />
              ) : (
                <ResultTable {...rows} />
              )}
            </>
          )}
        </div>
        {preview && note && (
          <PreviewPane
            note={note}
            onClose={() => setPreview(false)}
            onBoard={() => {
              setChecked(new Set([note.path]));
              setDialog("board");
            }}
          />
        )}
      </div>

      {dialog === "edit" && <EditCollectionDialog collection={collection} onClose={() => setDialog(null)} onSaved={() => {}} />}
      {dialog === "rename" && <RenameDialog name={collection.name} onRename={rename} onClose={() => setDialog(null)} />}
      {dialog === "pin" && <PinDialog path={collection.path} onClose={() => setDialog(null)} />}
      {dialog === "board" && <BoardDialog notes={picked.length > 0 ? picked : note ? [note] : []} onClose={() => setDialog(null)} onDone={() => setChecked(new Set())} />}
      {dialog === "trash" && (
        <ConfirmDialog title="Move this collection to the trash?" confirm="Move to trash" onConfirm={() => void trash()} onClose={() => setDialog(null)}>
          <p>“{collection.name}” only remembers a search. Your notes are not touched, and you can bring the collection back from the trash.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
