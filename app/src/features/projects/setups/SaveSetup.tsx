// "Save as a setup": one dialog, a name and a checklist. A setup is a way of
// starting a new project: this project's starting pages, the schemas and views
// of its tags and its default properties. Only the pages ticked are kept, and the
// list says what else comes along before anything is written. Save is one change
// that Undo takes back.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";

import type { SetupSource } from "../../../lib/vault/project-types";
import { Button } from "../../../ui/Button";
import { Modal } from "../../../ui/Modal";
import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import { useSaveSetupRequest } from "./request";
import { saveAsSetup } from "./setup-actions";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What comes along besides the pages, in a sentence; none when nothing does. */
export function alsoKept(source: SetupSource): string {
  const parts: string[] = [];
  if (source.tags.length > 0) parts.push(`the properties and views of ${source.tags.map((t) => `#${t}`).join(", ")}`);
  if (source.props.length > 0) parts.push(`the default ${source.props.length === 1 ? "property" : "properties"} ${source.props.join(", ")}`);
  return parts.length > 0 ? `Also kept: ${parts.join(" and ")}.` : "";
}

export function SaveSetup() {
  const request = useSaveSetupRequest((s) => s.request);
  const close = useSaveSetupRequest((s) => s.close);
  const notes = useWorkspace((s) => s.notes);
  const heading = useId();
  const [project, setProject] = useState(request?.project ?? "");
  const [source, setSource] = useState<SetupSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const typed = useRef(false);
  const projects = useMemo(
    () =>
      notes
        .filter((n) => n.kind === "project" && n.project)
        .map((n) => ({ folder: n.project!, title: titleOf(n) }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [notes],
  );

  // What the project has, for the project chosen; the pages directly under pages/ start ticked.
  useEffect(() => {
    setSource(null);
    setProblem(null);
    const client = useWorkspace.getState().client;
    if (!project || !client) return;
    let live = true;
    setLoading(true);
    client.previewProjectSetup(project).then(
      (found) => {
        if (!live) return;
        setSource(found);
        setTicked(new Set(found.pages.filter((p) => p.included).map((p) => p.path)));
        if (!typed.current) setName(`${found.title} setup`);
        setLoading(false);
      },
      (err: unknown) => {
        if (!live) return;
        setProblem(message(err));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [project]);

  if (!request) return null;
  const ready = source !== null && name.trim() !== "" && !busy;

  const toggle = (path: string) =>
    setTicked((was) => {
      const next = new Set(was);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready || !source) return;
    setBusy(true);
    setProblem(null);
    try {
      // The pages in the order the list shows them.
      await saveAsSetup(source.folder, name, source.pages.filter((p) => ticked.has(p.path)).map((p) => p.path));
      close();
    } catch (err) {
      setProblem(message(err));
      setBusy(false);
    }
  };

  const also = source ? alsoKept(source) : "";

  return (
    <Modal labelledBy={heading} onClose={close} className="ui-dialog">
      <form onSubmit={(event) => void save(event)}>
        <h2 id={heading} className="ui-dialog-title">
          Save as a setup
        </h2>
        <div className="ui-dialog-body space-y-3 text-13">
          <p className="text-muted">A setup is a way to start a new project: the pages you tick, the properties and views of this project's tags, and its default properties. Your other notes are never copied.</p>
          {!request.project && (
            <label className="block">
              <span className="mb-1 block text-12 font-medium text-muted">Project</span>
              <select className="ui-field w-full" aria-label="Project" value={project} disabled={busy} onChange={(event) => setProject(event.target.value)}>
                {!project && <option value="">Choose a project</option>}
                {projects.map((p) => (
                  <option key={p.folder} value={p.folder}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-12 font-medium text-muted">Name</span>
            <input
              autoFocus
              className="ui-field w-full"
              aria-label="Setup name"
              placeholder="What do you call this setup?"
              value={name}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                typed.current = true;
                setName(event.target.value);
              }}
            />
          </label>

          {loading && <p className="text-muted">Looking at the project…</p>}
          {source && (
            <fieldset className="rounded-md border border-line bg-panel p-3">
              <legend className="px-1 text-12 font-medium text-muted">Pages to keep</legend>
              {source.pages.length === 0 ? (
                <p className="text-muted">This project has no pages to keep. The setup will still bring what is listed below.</p>
              ) : (
                <>
                  <ul className="max-h-60 space-y-1 overflow-y-auto">
                    {source.pages.map((page) => (
                      <li key={page.path}>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" className="size-4 shrink-0 accent-[var(--color-accent)]" checked={ticked.has(page.path)} disabled={busy} onChange={() => toggle(page.path)} />
                          <span className="min-w-0 truncate">{page.title}</span>
                          {!page.included && <span className="shrink-0 text-12 text-muted">in a folder</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex items-center gap-2 text-12 text-muted">
                    <span aria-live="polite">{plural(ticked.size, "page", "pages")} kept</span>
                    <Button size="sm" disabled={busy} onClick={() => setTicked(new Set(source.pages.map((p) => p.path)))}>
                      Tick all
                    </Button>
                    <Button size="sm" disabled={busy || ticked.size === 0} onClick={() => setTicked(new Set())}>
                      Untick all
                    </Button>
                  </div>
                </>
              )}
              {also && <p className="mt-2 text-muted">{also}</p>}
            </fieldset>
          )}
          {problem && (
            <p role="alert" className="text-danger">
              {problem}
            </p>
          )}
        </div>
        <footer className="ui-dialog-foot">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" tone="primary" disabled={!ready}>
            {busy ? "Saving…" : "Save setup"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

export default SaveSetup;
