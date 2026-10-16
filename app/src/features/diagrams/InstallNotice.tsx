import { useEffect } from "react";

import { inTauri } from "../../lib/api";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { openSettingsAt } from "../workspace/views/settings/jump";
import { EDITOR_CREDIT, megabytes, useDiagramEditor } from "./editor";

/** The line that offers the diagram editor while it is not installed: what it is, how big, where from, and the licence.
 * Diagrams already in the vault show as pictures without it; it is only for drawing and editing. */
export function InstallNotice({ className = "" }: { className?: string }) {
  const info = useDiagramEditor((s) => s.info);
  const progress = useDiagramEditor((s) => s.progress);
  const installing = useDiagramEditor((s) => s.installing);
  const error = useDiagramEditor((s) => s.error);
  useEffect(() => {
    if (!info) void useDiagramEditor.getState().refresh();
  }, [info]);
  if (!info || info.installed) return null;
  const desktop = inTauri();
  const size = megabytes(info.bytes);
  const known = progress && progress.total > 0;
  const words = progress?.phase === "verifying" ? "Checking the download…" : progress?.phase === "extracting" ? "Unpacking the editor…" : known ? `Downloading ${Math.round(progress.done / 1_000_000)} MB of ${size}` : "Starting the download…";
  return (
    <section aria-label="Diagram editor" className={`flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 ${className}`}>
      <Icon name="diagram" className="size-5 shrink-0 text-muted" />
      <div className="min-w-[240px] flex-1">
        <div className="text-14 font-medium">{installing ? "Installing the diagram editor" : "The diagram editor is not installed"}</div>
        {installing ? (
          <div className="mt-1.5 flex items-center gap-3 text-12 text-muted">
            <progress className="h-1.5 w-48" max={known ? progress.total : undefined} value={known ? progress.done : undefined} aria-label="Install progress" />
            <span role="status">{words}</span>
          </div>
        ) : (
          <p className="mt-0.5 text-13 text-muted">
            Diagrams already in your vault show as pictures. To draw or change one, install the editor: a {size} download from {new URL(info.url || "https://github.com").host}, kept in this app only. {EDITOR_CREDIT}.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-13 text-danger">
            {error}
          </p>
        )}
      </div>
      {installing ? (
        <Button size="sm" onClick={() => void useDiagramEditor.getState().cancel()}>
          Cancel
        </Button>
      ) : (
        <>
          {desktop ? (
            <Button tone="primary" icon="download" onClick={() => void useDiagramEditor.getState().install()}>
              {error ? "Try again" : `Install diagram editor (${size})`}
            </Button>
          ) : (
            <span className="text-13 text-muted">Installing needs the desktop app.</span>
          )}
          {/* Where the editor is installed, removed and credited; opened in a tab so nothing here is lost. */}
          <Button tone="quiet" size="sm" icon="settings" title="Open Settings, Diagrams" onClick={() => openSettingsAt({ group: "diagrams", row: "diagrams.editor" }, "tab")}>
            Diagram settings
          </Button>
        </>
      )}
    </section>
  );
}
