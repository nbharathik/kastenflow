// Export a project as a bundle: a folder outside the vault that holds the
// project's pages, boards, decks, pictures, PDFs, tag schemas and the cited
// works' entries, with a manifest. The dialog shows what would go in before any
// file is written, says what a bundle never holds, and takes a new or empty
// folder. Nothing in the vault changes, so there is nothing to undo. A bundle
// comes back in through the Import view.

import { useEffect, useMemo, useState } from "react";

import { inTauri } from "../../../lib/api";
import type { BundleExported, BundlePlan } from "../../../lib/vault/bundle-types";
import { Button } from "../../../ui/Button";
import { Modal } from "../../../ui/Modal";
import { FolderPicker } from "../../vaults/FolderPicker";
import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import { NOT_INCLUDED, bundleName, joinPath, megabytes, planWords } from "./plan-words";
import { useExportRequest } from "./request";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function ExportProject() {
  const request = useExportRequest((s) => s.request);
  const close = useExportRequest((s) => s.close);
  const notes = useWorkspace((s) => s.notes);
  const [project, setProject] = useState(request?.project ?? "");
  const [plan, setPlan] = useState<BundlePlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<BundleExported | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const projects = useMemo(
    () =>
      notes
        .filter((n) => n.kind === "project" && n.project)
        .map((n) => ({ folder: n.project!, title: titleOf(n) }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [notes],
  );

  // What would go in, worked out without writing anything, for the project chosen.
  useEffect(() => {
    setPlan(null);
    setProblem(null);
    setDone(null);
    const client = useWorkspace.getState().client;
    if (!project || !client) return;
    let live = true;
    client.planExport(project).then(
      (found) => live && setPlan(found),
      (err: unknown) => live && setProblem(message(err)),
    );
    return () => {
      live = false;
    };
  }, [project]);

  if (!request) return null;
  const words = plan ? planWords(plan) : null;
  const title = plan?.project.title ?? projects.find((p) => p.folder === project)?.title ?? project;

  const write = async () => {
    const client = useWorkspace.getState().client;
    if (!client || !project) return;
    setBusy(true);
    setProblem(null);
    try {
      setDone(await client.exportProject(project, dest.trim()));
    } catch (err) {
      setProblem(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal label="Export a project" onClose={close} className="ui-dialog">
      <h2 className="ui-dialog-title">Export a project</h2>
      <div className="ui-dialog-body space-y-3 text-13">
        <p className="text-muted">A copy of one project as a folder you can keep, share or import into another vault: its pages, whiteboards, decks, pictures, PDFs, tags and the works it cites.</p>
        <label className="block">
          <span className="mb-1 block text-12 font-medium text-muted">Project</span>
          <select className="ui-field w-full" aria-label="Project" value={project} disabled={busy || done !== null} onChange={(event) => setProject(event.target.value)}>
            {!project && <option value="">Choose a project</option>}
            {projects.map((p) => (
              <option key={p.folder} value={p.folder}>
                {p.title}
              </option>
            ))}
          </select>
        </label>

        {words && (
          <section aria-label="What will go in" className="rounded-md border border-line bg-panel p-3">
            <p>
              <strong>{title}</strong>
            </p>
            <p>{words.summary}</p>
            {words.outside.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-muted">
                {words.outside.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {words.missing && <p className="mt-2 text-muted">{words.missing}</p>}
            <p className="mt-2 text-muted">{NOT_INCLUDED}</p>
          </section>
        )}

        {!done && (
          <label className="block">
            <span className="mb-1 block text-12 font-medium text-muted">Destination folder</span>
            <span className="flex gap-2">
              <input
                className="ui-field min-w-0 flex-1"
                aria-label="Destination folder"
                value={dest}
                placeholder={plan ? joinPath(inTauri() ? "~/Documents" : "/Documents", bundleName(title)) : "A new folder, outside the vault"}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setDest(event.target.value)}
              />
              {inTauri() && (
                <Button disabled={busy} onClick={() => setBrowsing(true)}>
                  Browse…
                </Button>
              )}
            </span>
            <small className="mt-1 block text-12 text-muted">A new folder, or an empty one, outside the vault. Nothing in the vault changes.</small>
          </label>
        )}

        {done && (
          <p role="status" aria-label="Exported" className="rounded-md border border-line bg-panel p-3">
            Wrote {done.files} {done.files === 1 ? "file" : "files"} ({megabytes(done.bytes)}) to <code className="break-all">{done.dest}</code>. To bring it into a vault, use Import and pick this folder.
          </p>
        )}
        {problem && (
          <p role="alert" className="text-danger">
            {problem}
          </p>
        )}
      </div>
      <footer className="ui-dialog-foot">
        {done ? (
          <Button tone="primary" onClick={close}>
            Close
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button tone="primary" disabled={busy || !plan || !dest.trim()} onClick={() => void write()}>
              {busy ? "Exporting…" : "Export"}
            </Button>
          </>
        )}
      </footer>
      {browsing && (
        <FolderPicker
          title="Where the bundle's folder goes"
          pickLabel="Put it here"
          onPick={(parent) => {
            setBrowsing(false);
            setDest(joinPath(parent, bundleName(title)));
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </Modal>
  );
}

export default ExportProject;
