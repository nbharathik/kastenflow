// One commit in the history feed: its time, what happened to what, its author
// and badges. Opening it fetches the files it changed (only then) and shows
// each note's text changes, with the details that changed named; a note's title
// opens it while it still exists. In the desktop app an opened change can be
// undone as a new commit, or the whole vault put back to it.

import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import type { ChangedFile, CommitInfo, NoteMeta, VaultClient } from "../../lib/vault/types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { Icon } from "../../ui/Icon";
import { writeEverything } from "../workspace/page/before-exit";
import { titleOf } from "../workspace/names";
import { reloadLists } from "../workspace/reload";
import { useWorkspace } from "../workspace/store";
import { describeChange, noteDiff } from "./change-words";
import { DiagramChange, PictureChange } from "./DiagramChange";
import { DiffStats, DiffView } from "./DiffView";
import { clock } from "./group";
import { message } from "./store";
import { ClientBadge, Pill, QUIET } from "./ui";
import { clientOf, count, splitSummary } from "./words";

/** Most files drawn at first for a commit that touched many. */
const FIRST_FILES = 8;

/** A deck a commit changed is drawn as slides. The slides code is large, so it loads with the first one shown. */
const DeckVersions = lazy(() => import("./deck/DeckChange").then((loaded) => ({ default: loaded.DeckVersions })));

/** What each commit changed, per client: commits never change, so once is enough. */
const changesCache = new WeakMap<VaultClient, Map<string, ChangedFile[]>>();

function cached(client: VaultClient | null, id: string): ChangedFile[] | null {
  return (client && changesCache.get(client)?.get(id)) ?? null;
}

function remember(client: VaultClient, id: string, files: ChangedFile[]): void {
  const map = changesCache.get(client) ?? new Map<string, ChangedFile[]>();
  map.set(id, files);
  changesCache.set(client, map);
}

/** `author` false leaves out who made it, for lists that already say (a session's). */
export function CommitRow({ commit, undone, author = true }: { commit: CommitInfo; undone: boolean; author?: boolean }) {
  const [open, setOpen] = useState(false);
  const change = describeChange(commit.summary);
  return (
    <li className="rounded-md">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={new Date(commit.time).toLocaleString()}
        className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-panel"
      >
        <span className="w-16 shrink-0 whitespace-nowrap text-12 tabular-nums text-muted">{clock(commit.time)}</span>
        <Icon name={change.icon} className="size-[15px] shrink-0 text-muted" />
        <span data-change className="min-w-0 flex-1 truncate text-13">
          <span className="font-medium">{change.subject}</span>
          {change.action && " "}
          {change.action && (
            <span className="ml-1 text-13 text-muted">
              {change.action}
              {change.detail && ` ${change.detail}`}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {commit.approvedBy && <Pill tone="ok">approved by {commit.approvedBy}</Pill>}
          {commit.undoes && <Pill title="Reverts an agent's change">undo</Pill>}
          {undone && <Pill title="A later commit undid this one">undone</Pill>}
          {author && (commit.agent ? <ClientBadge client={clientOf(commit.author)} /> : <span className="max-w-[10rem] truncate text-12 text-muted">{commit.author}</span>)}
        </span>
        <Icon name="chevron" className={`size-3.5 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <CommitFiles id={commit.id} />}
      {open && !undone && !commit.undoes && <UndoChange commit={commit} />}
    </li>
  );
}

/** Takes one change back as a new commit, as an import's own Undo does. */
function UndoChange({ commit }: { commit: CommitInfo }) {
  const desktop = useWorkspace((s) => s.client?.kind === "vault");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!desktop) return null;
  const undo = async () => {
    const { client, toast } = useWorkspace.getState();
    if (!client) return;
    setBusy(true);
    setProblem(null);
    try {
      const undone = await client.undoCommit(commit.id);
      if (undone.conflict) {
        setProblem(`Not undone: ${undone.conflict.path} changed since (${undone.conflict.detail.toLowerCase()}).`);
      } else {
        toast(`Undid “${splitSummary(commit.summary).text}”`);
        await reloadLists();
      }
    } catch (err) {
      setProblem(message(err));
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-3 pb-3 pl-2 pr-1 sm:pl-[5.25rem]">
      <button type="button" className={QUIET} disabled={busy} onClick={() => void undo()}>
        {busy ? "Undoing…" : "Undo this change"}
      </button>
      {!commit.merge && <RestoreVault commit={commit} />}
      {problem && (
        <span role="alert" className="text-13 text-(--kr-bad-ink)">
          {problem}
        </span>
      )}
    </div>
  );
}

/** Puts the whole vault back as it was after this change, as one change
 * that Undo takes back; pages made since go to the trash. */
function RestoreVault({ commit }: { commit: CommitInfo }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const restore = async () => {
    const { client, toast } = useWorkspace.getState();
    if (!client) return;
    setBusy(true);
    try {
      await writeEverything();
      const done = await client.restoreVault(commit.id);
      await reloadLists();
      const back = done.commit;
      toast(
        `Restored the vault to ${new Date(commit.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
        back ? { label: "Undo", run: () => void client.undoCommit(back).then(() => reloadLists()) } : undefined,
      );
    } catch (err) {
      toast(message(err));
    }
    setBusy(false);
    setAsking(false);
  };
  return (
    <>
      <button type="button" className={QUIET} disabled={busy} onClick={() => setAsking(true)}>
        Restore everything to this point…
      </button>
      {asking && (
        <ConfirmDialog title="Restore everything to this point?" confirm="Restore everything" busy={busy} onConfirm={() => void restore()} onClose={() => setAsking(false)}>
          <p>Every page and whiteboard goes back to how it was after this change. Anything made since goes to the trash, where it can be restored.</p>
          <p>It is one change: Undo takes it all back.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function CommitFiles({ id }: { id: string }) {
  const client = useWorkspace((s) => s.client);
  const notes = useWorkspace((s) => s.notes);
  const [files, setFiles] = useState<ChangedFile[] | null>(() => cached(client, id));
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (!client || files) return;
    let live = true;
    client.commitChanges(id).then(
      (found) => {
        remember(client, id, found);
        if (live) setFiles(found);
      },
      (err: unknown) => live && setError(message(err)),
    );
    return () => {
      live = false;
    };
  }, [client, id, files]);

  const pad = "pb-3 pl-2 pr-1 sm:pl-[5.25rem]";
  if (error) return <p className={`${pad} text-13 text-(--kr-bad-ink)`}>Could not read this change: {error}</p>;
  if (!files) return <p className={`${pad} text-13 text-muted`}>Reading the change…</p>;
  if (files.length === 0) return <p className={`${pad} text-13 text-muted`}>No files changed in this commit.</p>;
  const shown = all ? files : files.slice(0, FIRST_FILES);
  const byPath = new Map(notes.map((n) => [n.path, n]));
  return (
    <div className={`${pad} space-y-2`}>
      {shown.map((file) => (
        <FileDiff key={file.path} file={file} note={byPath.get(file.path)} withSource={files.some((f) => f.path === file.path.replace(/\.svg$/, "") && f.before !== f.after)} />
      ))}
      {files.length > shown.length && (
        <button type="button" className={QUIET} onClick={() => setAll(true)}>
          Show {count(files.length - shown.length, "more file")}
        </button>
      )}
    </div>
  );
}

/** `withSource`: a picture (`x.drawio.svg`) whose diagram (`x.drawio`) changed in the same commit. */
function FileDiff({ file, note, withSource }: { file: ChangedFile; note: NoteMeta | undefined; withSource: boolean }) {
  const openPath = useWorkspace((s) => s.openPath);
  const { lines, details } = useMemo(() => noteDiff(file.path, file.before, file.after), [file]);
  const binary = file.before === null && file.after === null;
  const deck = !binary && file.path.endsWith(".deck");
  // A diagram is told in words, its picture in a line: neither is read as lines of XML.
  const diagram = !binary && file.path.endsWith(".drawio");
  const picture = !binary && file.path.endsWith(".drawio.svg");
  const status = binary ? null : file.before === null ? "added" : file.after === null ? "removed" : null;
  const textChanged = lines.some((l) => l.kind !== "same");
  return (
    <div className="overflow-hidden rounded-md border border-line bg-canvas">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1 text-12">
        {note ? (
          <button type="button" onClick={() => openPath(file.path)} title={`${file.path}\nOpen this note`} className="min-w-0 truncate font-medium text-accent hover:underline">
            {titleOf(note)}
          </button>
        ) : (
          <span className="min-w-0 truncate font-mono text-muted" title={file.path.endsWith(".md") ? "This note is no longer here" : undefined}>
            {file.path}
          </span>
        )}
        {status && <Pill>{status}</Pill>}
        <span className="ml-auto" />
        {textChanged && !deck && !diagram && !picture && <DiffStats lines={lines} />}
      </div>
      {details.length > 0 && (
        <p className="border-b border-line px-3 py-1.5 text-13 text-muted last:border-b-0">
          {textChanged ? "Also changed: " : "Changed: "}
          {details.join(", ")}
        </p>
      )}
      {binary ? (
        <p className="px-3 py-2 text-13 text-muted">No text to show for this file.</p>
      ) : diagram ? (
        <DiagramChange path={file.path} before={file.before} after={file.after} />
      ) : picture ? (
        <PictureChange withSource={withSource} />
      ) : deck ? (
        <Suspense fallback={<p className="px-3 py-2 text-13 text-muted">Reading the slides…</p>}>
          <DeckVersions before={file.before} after={file.after} gone="The deck that was removed" bare />
        </Suspense>
      ) : textChanged ? (
        <div className="max-h-80 overflow-auto">
          <DiffView lines={lines} mode="unified" context={2} limit={200} label={`Changes to ${file.path}`} />
        </div>
      ) : (
        details.length === 0 && <p className="px-3 py-2 text-13 text-muted">The text did not change.</p>
      )}
    </div>
  );
}
