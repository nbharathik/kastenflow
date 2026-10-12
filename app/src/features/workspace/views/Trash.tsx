import { useEffect, useMemo, useState } from "react";

import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import type { Trashed } from "../../../lib/vault/types";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { useBoards } from "../../boards/store";
import { reloadLists } from "../reload";
import { useWorkspace } from "../store";
import { trashChanged, useTrashVersion } from "./trash-changed";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";
import { lineIcon } from "../../../ui/glyph";
import { Icon } from "../../../ui/Icon";
import { useReveal } from "../../../ui/useReveal";

/** "20260924T080000Z" as a readable local time. */
function when(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(stamp);
  if (!m) return stamp;
  const date = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Empties the trash into history, which only the person can do; Undo
 * brings every file back. */
function EmptyTrash({ count }: { count: number }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const empty = async () => {
    const { client, toast } = useWorkspace.getState();
    if (!client?.emptyTrash) return;
    setBusy(true);
    try {
      const emptied = await client.emptyTrash();
      await reloadLists();
      trashChanged();
      const kept = emptied.kept.length ? `. ${plural(emptied.kept.length, "file")} stayed, since history doesn't hold them as they are` : "";
      const commit = emptied.commit;
      const undo = () => void client.undoCommit(commit!).then(() => reloadLists()).then(trashChanged, (err: unknown) => toast(err instanceof Error ? err.message : String(err)));
      toast(`Emptied the trash${kept}`, commit ? { label: "Undo", run: undo } : undefined);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
    setAsking(false);
  };
  return (
    <>
      <button type="button" className="rounded-md border border-line px-2.5 py-1 text-13 hover:bg-panel" onClick={() => setAsking(true)}>
        Empty trash
      </button>
      {asking && (
        <ConfirmDialog title="Empty the trash?" confirm="Empty trash" danger busy={busy} onConfirm={() => void empty()} onClose={() => setAsking(false)}>
          <p>{plural(count, "item")} leave the trash and the folder. They stay in the vault's history, so you can still bring them back with Undo or from History.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** Trashed notes, newest first, each one click from coming back. Nothing
 * here deletes: the files stay in `.trash/` until the trash is emptied into
 * history. A find box narrows the list; several can come back at once;
 * a page can be read before it does. */
export function Trash() {
  const client = useWorkspace((s) => s.client);
  // What goes to the trash or comes back changes how many notes and boards
  // there are; an edit to a note does not, so it reads nothing again.
  const notes = useWorkspace((s) => s.notes.length);
  const boards = useBoards((s) => s.list.length);
  const emptied = useTrashVersion();
  const restore = useWorkspace((s) => s.restore);
  const [items, setItems] = useState<Trashed[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const q = query.trim().toLowerCase();
  const found = useMemo(() => (items ?? []).filter((item) => !q || item.title.toLowerCase().includes(q) || item.original.toLowerCase().includes(q)), [items, q]);
  const { shown, more } = useReveal(found.length);

  useEffect(() => {
    let cancelled = false;
    client?.listTrash().then(
      (found) => {
        if (cancelled) return;
        setItems(found);
        // What came back or left some other way is no longer picked.
        setPicked((was) => new Set([...was].filter((trashed) => found.some((item) => item.trashed === trashed))));
      },
      () => !cancelled && setItems([]),
    );
    return () => {
      cancelled = true;
    };
  }, [client, notes, boards, emptied]);

  const toggle = (trashed: string) =>
    setPicked((was) => {
      const next = new Set(was);
      if (!next.delete(trashed)) next.add(trashed);
      return next;
    });
  const restorePicked = async () => {
    const { client: vault, toast } = useWorkspace.getState();
    if (!vault) return;
    const chosen = [...picked];
    let back = 0;
    for (const trashed of chosen) {
      try {
        await (trashed.endsWith(".canvas") ? vault.restoreBoard(trashed) : trashed.endsWith(".deck") ? vault.restoreDeck(trashed) : trashed.endsWith(".drawio") || trashed.endsWith(".drawio.svg") ? vault.restoreDiagram(trashed) : vault.restore(trashed));
        back += 1;
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err));
      }
    }
    setPicked(new Set());
    await reloadLists();
    trashChanged();
    if (back) toast(`Restored ${plural(back, "item")}`);
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 pb-24 pt-10 sm:px-12">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-28 font-bold tracking-tight">
          <Icon name="trash" className="mr-2.5 inline size-[26px] align-[-4px] text-muted" />
          Trash
        </h1>
        {client?.emptyTrash && items && items.length > 0 && <EmptyTrash count={items.length} />}
      </div>
      <p className="mt-1 text-14 text-muted">Pages and whiteboards you trash wait here, in the vault's .trash folder, until you restore them. A page's sub-pages go and come back with it.</p>
      {items && items.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in the trash…"
            aria-label="Find in the trash"
            className="h-8 w-64 rounded-md border border-line bg-canvas px-2 text-13 outline-none focus:border-accent"
          />
          <span className="flex-1" />
          {picked.size > 0 && (
            <>
              <button type="button" className="rounded-md px-2.5 py-1 text-13 text-muted hover:bg-panel" onClick={() => setPicked(new Set())}>
                Clear
              </button>
              <button type="button" className="rounded-md bg-accent px-2.5 py-1 text-13 font-medium text-on-accent hover:brightness-110" onClick={() => void restorePicked()}>
                Restore {plural(picked.size, "item")}
              </button>
            </>
          )}
        </div>
      )}
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {items?.length === 0 && <li className="py-10 text-center text-14 text-muted">The trash is empty.</li>}
        {items && items.length > 0 && found.length === 0 && <li className="py-10 text-center text-14 text-muted">Nothing in the trash matches.</li>}
        {found.slice(0, shown).map((item) => (
          <TrashRow key={item.trashed} item={item} picked={picked.has(item.trashed)} onPick={() => toggle(item.trashed)} onRestore={() => void restore(item.trashed)} />
        ))}
      </ul>
      {shown < found.length && <div ref={more} aria-hidden className="h-px" />}
    </div>
  );
}

/** One trashed item: pick it, read it, or restore it. */
function TrashRow({ item, picked, onPick, onRestore }: { item: Trashed; picked: boolean; onPick(): void; onRestore(): void }) {
  const [text, setText] = useState<string | null>(null);
  const board = item.original.endsWith(".canvas");
  const deck = item.original.endsWith(".deck");
  const diagram = item.original.endsWith(".drawio");
  const read = async () => {
    if (text !== null) return setText(null);
    const client = useWorkspace.getState().client;
    try {
      setText(splitFrontmatter((await client!.readTrashed(item.trashed)) ?? "").body.trim() || "This page is empty.");
    } catch (err) {
      setText(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={picked} onChange={onPick} aria-label={`Pick ${item.title}`} className="size-4 shrink-0 accent-[var(--color-accent)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-14 font-medium">
            {board && (
              <span aria-label="Whiteboard" className="mr-1.5">
                <IconOrEmoji icon={lineIcon("board")} />
              </span>
            )}
            {deck && (
              <span aria-label="Deck" className="mr-1.5">
                <IconOrEmoji icon={lineIcon("present")} />
              </span>
            )}
            {diagram && (
              <span aria-label="Diagram" className="mr-1.5">
                <IconOrEmoji icon={lineIcon("diagram")} />
              </span>
            )}
            {item.title}
          </span>
          <span className="block truncate text-12 text-muted">
            {item.original} · {when(item.when)}
            {item.inside > 0 && ` · with ${item.inside} sub-page${item.inside === 1 ? "" : "s"}`}
          </span>
        </span>
        {!board && !deck && !diagram && (
          <button type="button" aria-expanded={text !== null} className="rounded-md px-2.5 py-1 text-13 text-muted hover:bg-panel hover:text-ink" onClick={() => void read()}>
            {text === null ? "Read" : "Hide"}
          </button>
        )}
        <button type="button" className="rounded-md border border-line px-2.5 py-1 text-13 hover:bg-panel" onClick={onRestore}>
          Restore
        </button>
      </div>
      {text !== null && (
        <div role="region" aria-label={`${item.title}, in the trash`} className="mt-2 ml-7 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md bg-panel px-3 py-2 text-13 text-muted">
          {text}
        </div>
      )}
    </li>
  );
}
