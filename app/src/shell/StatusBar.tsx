import { describeBackup, useVaultStatus, type Tone } from "../features/workspace/status";
import { useWorkspace } from "../features/workspace/store";
import { openable } from "../features/workspace/tree";
import { openSettingsAt } from "../features/workspace/views/settings/jump";
import { UpdatePill } from "../features/updates/UpdatePill";

export const DOT: Record<Tone, string> = {
  off: "bg-muted/50",
  ok: "bg-success",
  stale: "bg-warning",
  failing: "bg-danger",
};

/** Where the notes live, whether they are safe, and a newer Kasten when
 * one is out: quiet, in the faint text, until something needs a look.
 * The versions are in Settings → About. */
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
      {client?.kind === "vault" && <Backup />}
      <UpdatePill />
    </footer>
  );
}

/** The backup dot: green when pushed lately, amber after a day, red when failing. */
function Backup() {
  const status = useVaultStatus((s) => s.status);
  const error = useVaultStatus((s) => s.error);
  if (!status) return null;
  const shown = describeBackup(status);
  const tone = error ? "failing" : shown.tone;
  const detail = error ?? shown.detail;
  return (
    <button
      type="button"
      onClick={() => openSettingsAt({ group: "history" })}
      title={detail}
      aria-label={`${shown.label}. ${detail}`}
      className={`flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-hover hover:text-ink ${tone === "ok" ? "" : "text-muted"}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${DOT[tone]}`} />
      {error ? "Problem saving history" : shown.label}
      {status.pending > 0 && <span>· {status.pending} edited</span>}
    </button>
  );
}
