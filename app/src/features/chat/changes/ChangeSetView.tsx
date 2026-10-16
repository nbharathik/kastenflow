// What a chat has staged, to look at before anything is written: each file
// the chat changed or made, with the change drawn as the review queue draws
// it (a text diff, or the slides that differ for a deck), the pictures it
// added, and what it did step by step. A file the vault changed since is
// marked, with a way to plan the chat's steps again.

import "../../review/review.css";
import "./changes.css";

import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { Icon } from "../../../ui/Icon";
import { DiagramBeforeAfter } from "../../diagrams/ai/BeforeAfter";
import { diffLines } from "../../review/diff";
import { DiffStats, DiffView } from "../../review/DiffView";
import { BUTTON, Callout, Pill } from "../../review/ui";
import { count } from "../../review/words";
import type { Thread } from "../thread";
import type { ChangesView, FileChange, Recalculated } from "../types";
import { KIND_WORDS, loadChanges, ordered, recalcChanges, staleOf } from "./changes";

/** A deck is drawn as slides; the slides code is large, so it loads with the first one shown. */
const DeckVersions = lazy(() => import("../../review/deck/DeckChange").then((m) => ({ default: m.DeckVersions })));

const kb = (bytes: number) => (bytes < 1024 ? `${bytes} bytes` : bytes < 1_048_576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`);

export function ChangeSetView({ thread }: { thread: Thread }) {
  const [view, setView] = useState<ChangesView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dropped, setDropped] = useState<Recalculated["dropped"]>([]);
  const [busy, setBusy] = useState(false);
  const id = thread.id;
  const marker = `${thread.changes?.id ?? ""}:${thread.changes?.count ?? 0}`;

  // Read when opened, and again when the chat stages more or the set is replaced.
  useEffect(() => {
    let live = true;
    loadChanges(id).then(
      (loaded) => live && (setView(loaded), setProblem(null)),
      (err) => live && setProblem(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [id, marker]);

  const stale = useMemo(() => (view ? staleOf(view) : []), [view]);
  const files = useMemo(() => (view ? ordered(view.files) : []), [view]);

  const recalc = async () => {
    setBusy(true);
    const done = await recalcChanges(id);
    setBusy(false);
    if (done.ok) {
      setDropped(done.value.dropped);
      setProblem(null);
    } else setProblem(done.error);
  };

  if (!view) {
    return (
      <div className="kasten-changes-view" aria-busy={problem === null}>
        {problem ? (
          <Callout tone="bad" icon="alert" role="alert">
            {problem}
          </Callout>
        ) : (
          <p className="kasten-changes-note">Reading the staged changes…</p>
        )}
      </div>
    );
  }
  return (
    <div className="kasten-changes-view" role="region" aria-label="Staged changes">
      <p className="kasten-changes-note">Nothing here is in your notes yet. Apply writes it all as one change that “Undo this chat's changes” takes back.</p>
      {stale.length > 0 && (
        <Callout tone="warn" icon="alert" role="status">
          <p>
            {stale.length === 1 ? "A file" : `${stale.length} files`} changed since the chat staged {stale.length === 1 ? "its" : "their"} change, in a way that cannot be put together with it: {stale.map((f) => f.title).join(", ")}. Nothing is written until that is settled.
          </p>
          <button type="button" className={`${BUTTON} mt-2`} disabled={busy} onClick={() => void recalc()}>
            {busy ? "Recalculating…" : "Recalculate"}
          </button>
        </Callout>
      )}
      {dropped.length > 0 && (
        <Callout tone="warn" icon="alert" role="status">
          <p>{dropped.length === 1 ? "One step" : `${dropped.length} steps`} could not be made again on your notes as they are, and {dropped.length === 1 ? "was" : "were"} left out:</p>
          <ul className="kasten-changes-dropped">
            {dropped.map((step, i) => (
              <li key={i}>
                {step.summary}: {step.why}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {problem && (
        <Callout tone="bad" icon="alert" role="alert">
          {problem}
        </Callout>
      )}
      <ul className="kasten-changes-files">
        {files.map((file) => (
          <li key={file.path}>
            <File file={file} />
          </li>
        ))}
      </ul>
      {view.pictures.length > 0 && (
        <section className="kasten-changes-section" aria-label="Pictures">
          <h4>{count(view.pictures.length, "picture")} added</h4>
          <ul>
            {view.pictures.map((picture) => (
              <li key={picture.path}>
                <Icon name="image" className="size-3.5" /> {picture.path} <span className="kasten-changes-muted">· {kb(picture.bytes)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.steps.length > 0 && (
        <details className="kasten-changes-section">
          <summary>What the chat did ({view.steps.length})</summary>
          <ol>
            {view.steps.map((step, i) => (
              <li key={i}>{step.summary}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function File({ file }: { file: FileChange }) {
  const [open, setOpen] = useState(true);
  const lines = useMemo(() => (file.kind === "deck" ? null : diffLines(file.before, file.after)), [file.kind, file.before, file.after]);
  return (
    <article className="kasten-changes-file" data-stale={file.stale || undefined} aria-label={`${file.new ? "New" : "Changed"} ${KIND_WORDS[file.kind].toLowerCase()} ${file.title}`}>
      <header>
        <button type="button" className="kasten-changes-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? "chevron-up" : "chevron-down"} className="size-3.5" />
          <span className="kasten-changes-title">{file.title}</span>
        </button>
        <span className="kasten-changes-path">{file.path}</span>
        <Pill tone={file.new ? "ok" : "plain"}>{file.new ? `New ${KIND_WORDS[file.kind].toLowerCase()}` : KIND_WORDS[file.kind]}</Pill>
        {file.stale && <Pill tone="warn">Changed since</Pill>}
        {lines && <DiffStats lines={lines} />}
      </header>
      {open &&
        (file.kind === "diagram" ? (
          <DiagramBeforeAfter file={file} lines={lines} />
        ) : lines ? (
          <div className="kasten-changes-diff">
            <DiffView lines={lines} mode="unified" label={`Changes to ${file.title}`} />
          </div>
        ) : (
          <Suspense fallback={<p aria-busy="true" className="kasten-changes-note">Reading the slides…</p>}>
            <DeckVersions before={file.before} after={file.after} words={file.new ? `New deck “${file.title}”` : `Changes to “${file.title}”`} />
          </Suspense>
        ))}
    </article>
  );
}
