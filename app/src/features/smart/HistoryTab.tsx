// The History of a smart page's code: the commits that changed its folder, what
// each changed file by file (the review feed's own diff), and "Restore this
// version", which puts the code back as a new version on top. Nothing is
// rewritten: the versions under it stay, and Undo takes the restore back.

import { useEffect, useMemo, useState } from "react";

import { relativeTime } from "../../lib/dates";
import { sidecarDir } from "../../lib/vault/smart-types";
import type { ChangedFile, CommitInfo } from "../../lib/vault/types";
import { Button } from "../../ui/Button";
import { describeChange } from "../review/change-words";
import { DiffStats, DiffView } from "../review/DiffView";
import { diffLines } from "../review/diff";
import { authorOf, versionTime } from "../panel/history/versions";
import { reloadLists } from "../workspace/reload";
import { useWorkspace } from "../workspace/store";
import { openSettingsAt } from "../workspace/views/settings/jump";
import type { SmartBackend } from "./backend";

interface Props {
  pagePath: string;
  backend: SmartBackend;
  /** What a commit changed, from the app's history; the open vault's by default. */
  changes?: (rev: string) => Promise<ChangedFile[]>;
  /** A version was put back (or the restore was undone): load the page again. */
  onRestored(): void;
}

/** Versions asked for at a time, and the most the app gives. */
const PAGE_OF_VERSIONS = 50;
const MOST_VERSIONS = 200;

const message = (err: unknown) => (err instanceof Error ? err.message : typeof err === "string" ? err : "That did not work.");

/** "Edited app.js" for a version whose summary names a file of the folder. */
export function versionWords(summary: string): string {
  const change = describeChange(summary);
  if (!change.action) return summary;
  const file = /\(([^()]+)\)\s*$/.exec(change.subject)?.[1];
  return [change.action, file ?? change.subject, change.detail].filter(Boolean).join(" ");
}

export function HistoryTab({ pagePath, backend, changes, onRestored }: Props) {
  const [versions, setVersions] = useState<CommitInfo[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  // The newest versions first; "Show older versions" asks for more, up to what the app gives.
  const [limit, setLimit] = useState(PAGE_OF_VERSIONS);

  useEffect(() => {
    let live = true;
    backend.history(pagePath, limit).then(
      (found) => live && (setVersions(found), setProblem(null)),
      (err: unknown) => live && setProblem(message(err)),
    );
    return () => {
      live = false;
    };
  }, [backend, pagePath, round, limit]);

  if (problem) return <p className="kasten-smart-note">The history of this page’s code could not be read: {problem}</p>;
  if (!versions) return <p className="kasten-smart-wait" role="status">Reading the history…</p>;
  if (versions.length === 0) {
    return (
      <div className="kasten-smart-note kasten-smart-empty">
        <p>No versions of this page’s code are kept yet. Each saved change to its files becomes a version you can go back to.</p>
        <Button size="sm" onClick={() => openSettingsAt({ group: "history", row: "history.history" })}>
          Check History in Settings
        </Button>
      </div>
    );
  }
  const version = versions.find((v) => v.id === picked) ?? versions[0]!;
  const newest = version.id === versions[0]!.id;
  return (
    <div className="kasten-smart-history">
      <ol className="kasten-smart-versions" aria-label="Versions of this page’s code">
        {versions.map((v) => (
          <li key={v.id}>
            <button type="button" aria-current={v.id === version.id ? "true" : undefined} onClick={() => setPicked(v.id)}>
              <span className="kasten-smart-version-when" title={new Date(v.time).toLocaleString()}>
                {relativeTime(v.time)}
              </span>
              <span className="kasten-smart-version-what">
                {versionWords(v.summary)}
                {v.agent ? ` · ${authorOf(v)}` : ""}
              </span>
            </button>
          </li>
        ))}
        {versions.length >= limit && limit < MOST_VERSIONS && (
          <li>
            <Button size="sm" tone="quiet" onClick={() => setLimit((n) => Math.min(n + PAGE_OF_VERSIONS, MOST_VERSIONS))}>
              Show older versions
            </Button>
          </li>
        )}
      </ol>
      <VersionFiles
        key={version.id}
        pagePath={pagePath}
        backend={backend}
        version={version}
        newest={newest}
        changes={changes}
        onRestored={() => {
          setRound((n) => n + 1);
          onRestored();
        }}
      />
    </div>
  );
}

function VersionFiles({ pagePath, backend, version, newest, changes, onRestored }: { pagePath: string; backend: SmartBackend; version: CommitInfo; newest: boolean; changes: Props["changes"]; onRestored(): void }) {
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dir = `${sidecarDir(pagePath) ?? ""}/`;

  useEffect(() => {
    let live = true;
    const read = changes ?? ((rev: string) => (useWorkspace.getState().client ? useWorkspace.getState().client!.commitChanges(rev) : Promise.resolve([])));
    read(version.id).then(
      (found) => live && setFiles(found.filter((f) => f.path.startsWith(dir))),
      (err: unknown) => live && setProblem(message(err)),
    );
    return () => {
      live = false;
    };
  }, [changes, version.id, dir]);

  const restore = async () => {
    setBusy(true);
    const { toast, client } = useWorkspace.getState();
    try {
      const done = await backend.restoreVersion(pagePath, version.id);
      onRestored();
      const back = done.commit;
      if (back === null) toast("The code is already this version");
      else {
        toast(
          `Put the code back to ${versionTime(version.time)}`,
          client ? { label: "Undo", run: () => void client.undoCommit(back).then(() => reloadLists()).then(onRestored, () => {}) } : undefined,
        );
      }
    } catch (err) {
      toast(message(err));
    }
    setBusy(false);
  };

  return (
    <section className="kasten-smart-version" aria-label="Chosen version">
      <div className="kasten-smart-version-head">
        <strong>{versionTime(version.time)}</strong>
        <span>{authorOf(version)}</span>
        <Button tone="primary" size="sm" disabled={busy || newest} onClick={() => void restore()} title={newest ? "This is the newest version" : undefined}>
          {busy ? "Restoring…" : "Restore this version"}
        </Button>
      </div>
      {problem ? (
        <p className="kasten-smart-note">Could not read this change: {problem}</p>
      ) : files === null ? (
        <p className="kasten-smart-wait" role="status">
          Reading the change…
        </p>
      ) : files.length === 0 ? (
        <p className="kasten-smart-note">No files of the page’s code changed in this version.</p>
      ) : (
        files.map((file) => <FileChange key={file.path} file={file} dir={dir} />)
      )}
    </section>
  );
}

function FileChange({ file, dir }: { file: ChangedFile; dir: string }) {
  const lines = useMemo(() => diffLines(file.before, file.after), [file]);
  const binary = file.before === null && file.after === null;
  const status = binary ? null : file.before === null ? "added" : file.after === null ? "removed" : null;
  const name = file.path.slice(dir.length);
  return (
    <div className="kasten-smart-file">
      <div className="kasten-smart-file-head">
        <span className="kasten-smart-file-name">{name}</span>
        {status && <span className="kasten-smart-file-status">{status}</span>}
        {!binary && <DiffStats lines={lines} />}
      </div>
      {binary ? <p className="kasten-smart-note">No text to show for this file.</p> : <DiffView lines={lines} mode="unified" context={2} limit={200} label={`Changes to ${name}`} />}
    </div>
  );
}
