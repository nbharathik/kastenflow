// Bringing notes in from Obsidian, Notion, Heptabase or a Markdown folder:
// pick where from (with how to get the folder out), browse for, type or
// paste the folder, or drop it on the window; look at what would come
// across, then import it as one change, which the result can take back.

import { useEffect, useState, type FormEvent } from "react";

import { inTauri } from "../../lib/api";
import type { ImportKind, ImportSummary, Imported } from "../../lib/vault/types";
import { FolderPicker } from "../vaults/FolderPicker";
import { useWorkspace } from "../workspace/store";
import { useImportRequest } from "./drop";
import { KINDS, pathTip } from "./kinds";
import { counts, planImport, runImport, undoImport, useUndoneImport } from "./run";

import "./import.css";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { Icon } from "../../ui/Icon";

type Busy = "checking" | "importing" | "undoing" | null;

const LABELS: Record<ImportKind, string> = {
  obsidian: "an Obsidian vault",
  markdown: "a Markdown folder",
  notion: "a Notion export",
  heptabase: "a Heptabase backup",
  bundle: "a KastenFlow project bundle",
};

export function ImportView() {
  const [kind, setKind] = useState<ImportKind>("obsidian");
  const [source, setSource] = useState("");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [plan, setPlan] = useState<ImportSummary | null>(null);
  const [done, setDone] = useState<Imported | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const requested = useImportRequest((s) => s.source);
  const undoneCommit = useUndoneImport((s) => s.commit);
  const info = KINDS.find((k) => k.id === kind)!;
  // Taken back from the notice's Undo: the result card has nothing left to say.
  useEffect(() => {
    if (done?.commit && done.commit === undoneCommit) setDone(null);
  }, [done, undoneCommit]);
  const options = { project: project.trim() || undefined };

  const look = async (from: string) => {
    if (!from.trim() || busy) return;
    setBusy("checking");
    setError(null);
    setPlan(null);
    const found = await planImport(from, options);
    setBusy(null);
    if (found.ok) setPlan(found.value);
    else setError(found.error);
  };
  const check = (event?: FormEvent) => {
    event?.preventDefault();
    void look(source);
  };
  // A folder picked with Browse, or dropped on the window, is looked at at once.
  const lookAt = (from: string) => {
    setDone(null);
    setSource(from);
    void look(from);
  };
  useEffect(() => {
    if (!requested) return;
    useImportRequest.setState({ source: null });
    setKind("markdown");
    lookAt(requested);
  }, [requested]);
  const run = async () => {
    setBusy("importing");
    setError(null);
    const imported = await runImport(source, options);
    setBusy(null);
    if (!imported.ok) return setError(imported.error);
    setDone(imported.value);
    setPlan(null);
  };
  const undo = async () => {
    if (!done?.commit) return;
    setBusy("undoing");
    setError(null);
    const undone = await undoImport(done.commit);
    setBusy(null);
    if (undone.ok) setDone(null);
    else setError(undone.error);
  };
  const again = () => {
    setDone(null);
    setSource("");
    setProject("");
    setError(null);
  };
  // What was looked at is what gets imported.
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPlan(null);
  };

  return (
    <div className="kasten-import">
      <header className="kasten-import-head">
        <h1>Bring your notes in</h1>
        <p>From Obsidian, Notion, Heptabase or any folder of Markdown. Everything arrives as one project, in one change you can undo.</p>
      </header>

      {done ? (
        <Result done={done} busy={busy} onUndo={undo} onAgain={again} />
      ) : (
        <>
          <div className="kasten-import-kinds" role="radiogroup" aria-label="Where the notes are">
            {KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={k.id === kind} className="kasten-import-kind" onClick={() => setKind(k.id)}>
                <span className="kasten-import-kind-icon" aria-hidden="true">
                  <IconOrEmoji icon={k.icon} />
                </span>
                <strong>{k.name}</strong>
                <span>{k.brings}</span>
              </button>
            ))}
          </div>

          {/* What was looked at is what gets imported: no edits while looking or importing. */}
          <form className="kasten-import-form" onSubmit={check} aria-busy={busy !== null}>
            <ol className="kasten-import-steps" aria-label={`Getting the folder from ${info.name}`}>
              {info.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <label className="kasten-import-field">
              <span>Folder</span>
              <span className="kasten-import-pick">
                <input value={source} onChange={(e) => edit(setSource)(e.target.value)} placeholder={info.example} spellCheck={false} autoComplete="off" disabled={busy !== null} />
                {inTauri() && (
                  <button type="button" className="kasten-import-quiet" disabled={busy !== null} onClick={() => setBrowsing(true)}>
                    Browse…
                  </button>
                )}
              </span>
              <small>{inTauri() ? `${pathTip()} Or drop the folder on the window.` : pathTip()}</small>
            </label>
            <label className="kasten-import-field">
              <span>Project</span>
              <input value={project} onChange={(e) => edit(setProject)(e.target.value)} placeholder="Named after the folder" disabled={busy !== null} />
              <small>The new project everything goes into. Journal days join your journal.</small>
            </label>
            <button type="submit" className="kasten-import-look" disabled={!source.trim() || busy !== null}>
              {busy === "checking" ? "Looking…" : "Look at the folder"}
            </button>
          </form>

          {plan && <Plan plan={plan} busy={busy} onImport={() => void run()} />}
          {browsing && (
            <FolderPicker
              title="The folder to import"
              start={source.trim() || undefined}
              pickLabel="Look at it"
              onPick={(path) => {
                setBrowsing(false);
                lookAt(path);
              }}
              onClose={() => setBrowsing(false)}
            />
          )}
        </>
      )}
      {error && (
        <p className="kasten-import-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Tiles({ summary }: { summary: ImportSummary }) {
  const tiles: [number, string, string?][] = [
    [summary.notes, "notes"],
    [summary.days + summary.daysAppended, "journal days", summary.daysAppended ? `${summary.daysAppended} added to days you have` : undefined],
    [summary.boards, "boards"],
    [summary.files, "files"],
    [summary.tags, "tags"],
  ];
  return (
    <ul className="kasten-import-tiles">
      {tiles
        .filter(([n]) => n > 0)
        .map(([n, label, note]) => (
          <li key={label}>
            <strong>{n}</strong>
            <span>{label}</span>
            {note && <small>{note}</small>}
          </li>
        ))}
    </ul>
  );
}

/** What did not come across as it was, then what a bundle's import settled because the vault had the same thing. */
const thingsToKnow = (summary: ImportSummary): string[] => [...summary.warnings, ...(summary.conflicts ?? []).map((c) => `${c.what}: ${c.resolution}`)];

/** `open`: shown unfolded, for what the person must see before importing (a bundle's clashes with what the vault has). */
function Warnings({ warnings, open = false }: { warnings: string[]; open?: boolean }) {
  if (warnings.length === 0) return null;
  return (
    <details className="kasten-import-warnings" open={open}>
      <summary>
        {warnings.length} thing{warnings.length === 1 ? "" : "s"} to know
      </summary>
      <ul>
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

function Plan({ plan, busy, onImport }: { plan: ImportSummary; busy: Busy; onImport(): void }) {
  return (
    <section className="kasten-import-card" aria-label="What will come in">
      <p className="kasten-import-found">
        This is {LABELS[plan.kind]}. It becomes the project <strong>“{plan.project}”</strong>:
      </p>
      <Tiles summary={plan} />
      {/* A bundle's clashes with what the vault has are shown before anything is written. */}
      <Warnings warnings={thingsToKnow(plan)} open={(plan.conflicts?.length ?? 0) > 0} />
      <div className="kasten-import-actions">
        <button type="button" className="kasten-import-go" disabled={busy !== null} onClick={onImport}>
          {busy === "importing" ? "Importing…" : `Import ${counts(plan)}`}
        </button>
        <span>Nothing changes until you import.</span>
      </div>
    </section>
  );
}

function Result({ done, busy, onUndo, onAgain }: { done: Imported; busy: Busy; onUndo(): void; onAgain(): void }) {
  const summary = done.summary;
  return (
    <section className="kasten-import-card is-done" aria-label="Imported">
      <p className="kasten-import-found">
        <Icon name="circle-check" className="mr-1 inline size-4 align-[-3px] text-success" /> Imported {counts(summary)} into <strong>“{summary.project}”</strong>.
      </p>
      <Tiles summary={summary} />
      <Warnings warnings={thingsToKnow(summary)} />
      <div className="kasten-import-actions">
        <button type="button" className="kasten-import-go" onClick={() => useWorkspace.getState().openPath(summary.projectPath)}>
          Open the project
        </button>
        {done.commit && (
          <button type="button" className="kasten-import-quiet" disabled={busy !== null} onClick={onUndo}>
            {busy === "undoing" ? "Undoing…" : "Undo the import"}
          </button>
        )}
        <button type="button" className="kasten-import-quiet" onClick={onAgain}>
          Import more
        </button>
      </div>
    </section>
  );
}
