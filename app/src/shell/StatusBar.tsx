import { ActivityStatus } from "../features/health/ActivityStatus";
import { type Tone } from "../features/workspace/status";
import { useWorkspace } from "../features/workspace/store";
import { openable } from "../features/workspace/tree";
import { UpdatePill } from "../features/updates/UpdatePill";

export const DOT: Record<Tone, string> = {
  off: "bg-muted/50",
  ok: "bg-success",
  stale: "bg-warning",
  failing: "bg-danger",
};

/** Where the notes live, how many there are, one indicator for how things
 * stand (saved, saving, indexing, outside changes, proposals, stale or
 * failed, with the backup beside "Saved") and a newer Kasten when one is
 * out: quiet, in the faint text, until something needs a look. The versions
 * are in Settings → About. */
export function StatusBar() {
  const client = useWorkspace((s) => s.client);
  const count = useWorkspace((s) => openable(s.notes).length);

  return (
    <footer role="contentinfo" className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-12 text-faint">
      <span aria-label="Vault" className="truncate">
        {client?.kind === "preview" ? `Browser preview: sample notes, ${client.kept === "memory" ? "kept until you reload" : "saved in this browser"}` : client ? client.label : ""}
      </span>
      <span aria-hidden="true" className="ml-auto" />
      {client && <span className="shrink-0">{count} notes</span>}
      <ActivityStatus />
      <UpdatePill />
    </footer>
  );
}
