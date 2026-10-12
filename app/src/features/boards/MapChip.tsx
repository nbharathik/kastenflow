// In a page map's top bar: bring the map in step with its page ("Sync with
// page", or "Page changed: sync" once the page differs from the map), and
// what to do about extra copies of the same map. The bar shows only what
// the open board found (map-live.ts).

import { useState } from "react";

import { relativeTime } from "../../lib/dates";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { useWorkspace } from "../workspace/store";
import { useMapStatus } from "./map-live";
import { useBoards } from "./store";

export function MapChip({ path }: { path: string }) {
  const status = useMapStatus((s) => s.by[path]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!status) return null;
  const { page, changes, primary, copies } = status;
  const title = page?.title ?? "its page";

  const trashCopies = async () => {
    setBusy(true);
    const { trash, restore, toast } = useWorkspace.getState();
    const trashed: string[] = [];
    for (const copy of copies) {
      const gone = await trash(copy.path, true);
      if (gone) trashed.push(gone);
    }
    setBusy(false);
    setAsking(false);
    void useBoards.getState().load();
    if (trashed.length > 0) toast(`Moved ${trashed.length} extra ${trashed.length === 1 ? "copy" : "copies"} to the trash`, { label: "Undo", run: () => trashed.forEach((t) => void restore(t)) });
  };

  return (
    <div className="mr-1 flex shrink-0 items-center gap-1">
      {primary !== null && primary !== path ? (
        <Button size="sm" tone="quiet" icon="board" title="This is an older copy of the page's map" onClick={() => useWorkspace.getState().openPath(primary)}>
          <span className="kasten-topbar-word">Open the page's map</span>
        </Button>
      ) : !page ? (
        <span className="px-2 text-12 text-muted" title="The page this map was made from is not in the vault">
          Page not found
        </span>
      ) : (
        <Button size="sm" tone={changes > 0 ? "secondary" : "quiet"} icon="refresh" disabled={status.busy} title={`Bring this map in step with “${title}”`} onClick={() => void status.sync()}>
          <span className="kasten-topbar-word">{status.busy ? "Syncing…" : changes > 0 ? "Page changed: sync" : "Sync with page"}</span>
        </Button>
      )}
      {copies.length > 0 && (
        <Button size="sm" tone="quiet" icon="copy" title="More maps of this page" onClick={() => setAsking(true)}>
          <span className="kasten-topbar-word">{copies.length} more {copies.length === 1 ? "copy" : "copies"} of this map</span>
        </Button>
      )}
      {asking && (
        <ConfirmDialog title="Move the extra copies to the trash?" confirm={`Move ${copies.length} to the trash`} busy={busy} onConfirm={() => void trashCopies()} onClose={() => setAsking(false)}>
          <p>
            “{title}” has {copies.length} more {copies.length === 1 ? "map" : "maps"} besides this one. They go to the trash, where each can be brought back.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {copies.map((copy) => (
              <li key={copy.path}>
                {copy.title} <span className="text-muted">· edited {relativeTime(copy.modified)}</span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}
