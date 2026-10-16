// The small questions a collection asks: its new name, and which projects'
// overviews it is pinned to.

import { useId, useState } from "react";

import { COLLECTION_LIMITS } from "../../lib/vault/collection-types";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { projects } from "../workspace/tree";
import { titleOf } from "../workspace/names";
import { useWorkspace } from "../workspace/store";
import { MAX_PINNED, pinnedIn, usePins } from "./pins";

export function RenameDialog({ name, onRename, onClose }: { name: string; onRename(name: string): Promise<void>; onClose(): void }) {
  const id = useId();
  const [text, setText] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy || text.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await onRename(text.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose} className="ui-dialog">
      <h2 id={`${id}-title`} className="ui-dialog-title">
        Rename collection
      </h2>
      <form
        className="ui-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="block text-13 font-medium">
          Name
          <input autoFocus className="ui-field mt-1 w-full" value={text} maxLength={COLLECTION_LIMITS.name} onFocus={(event) => event.target.select()} onChange={(event) => setText(event.target.value)} />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-13 text-danger">
            {error}
          </p>
        )}
      </form>
      <footer className="ui-dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" disabled={busy || text.trim() === "" || text.trim() === name} onClick={() => void submit()}>
          Rename
        </Button>
      </footer>
    </Modal>
  );
}

/** Ticks the projects whose overview shows the collection. */
export function PinDialog({ path, onClose }: { path: string; onClose(): void }) {
  const id = useId();
  const notes = useWorkspace((s) => s.notes);
  const pins = usePins((s) => s.pins);
  const list = projects(notes);
  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose} className="ui-dialog">
      <h2 id={`${id}-title`} className="ui-dialog-title">
        Pin to a project’s overview
      </h2>
      <div className="ui-dialog-body">
        {list.length === 0 ? (
          <p className="text-13 text-muted">There are no projects yet.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label="Projects">
            {list.map((project) => {
              const scope = { kind: "project", folder: project.project! } as const;
              const here = pinnedIn(pins, scope);
              const pinned = here.includes(path);
              return (
                <li key={project.path}>
                  <label className="flex items-center gap-2 rounded px-2 py-1.5 text-14 hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={pinned}
                      disabled={!pinned && here.length >= MAX_PINNED}
                      onChange={() => (pinned ? usePins.getState().unpin(scope, path) : usePins.getState().pin(scope, path))}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    <span className="truncate">{titleOf(project)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="ui-dialog-foot">
        <Button tone="primary" onClick={onClose}>
          Done
        </Button>
      </footer>
    </Modal>
  );
}
