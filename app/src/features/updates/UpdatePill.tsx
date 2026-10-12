// A newer Kasten, in the status bar until it is installed or skipped: the
// toast says it once, and this keeps it a click away. Once downloaded, one
// click installs it and restarts.

import { Icon } from "../../ui/Icon";
import { installAndRestart } from "./install";
import { selectAvailable, useUpdates } from "./store";

const PILL = "flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 font-medium text-accent hover:bg-line/60 disabled:opacity-60";

export function UpdatePill({ install = installAndRestart }: { install?: () => Promise<void> }) {
  const available = useUpdates(selectAvailable);
  const phase = useUpdates((s) => s.phase);
  if (!available) return null;
  if (phase === "ready" || phase === "installing") {
    return (
      <button
        type="button"
        disabled={phase === "installing"}
        onClick={() => void install()}
        title={`KastenFlow ${available.latest} is downloaded. Restart to install it.`}
        className={PILL}
      >
        <Icon name="download" className="size-3" />
        {phase === "installing" ? "Installing…" : "Restart to update"}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => useUpdates.getState().show()} title={`KastenFlow ${available.latest} is out. See what’s new.`} className={PILL}>
      <Icon name="sparkle" className="size-3" />
      Update to {available.latest}
    </button>
  );
}
