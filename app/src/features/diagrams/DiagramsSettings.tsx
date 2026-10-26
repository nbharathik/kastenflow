import { useEffect } from "react";

import { inDemo } from "../../demo/flag";
import { inTauri } from "../../lib/api";
import { Button } from "../../ui/Button";
import { Group, Note, Row } from "../workspace/views/settings/parts";
import { EDITOR_CREDIT, megabytes, useDiagramEditor } from "./editor";

/** Settings → Diagrams: the optional diagram editor, installed on request, with the credit it is owed. Diagrams already in the vault
 * show as pictures without it. */
export function DiagramsSettings() {
  const info = useDiagramEditor((s) => s.info);
  const progress = useDiagramEditor((s) => s.progress);
  const installing = useDiagramEditor((s) => s.installing);
  const error = useDiagramEditor((s) => s.error);
  useEffect(() => {
    void useDiagramEditor.getState().refresh();
  }, []);

  const desktop = inTauri() || inDemo();
  const size = info ? megabytes(info.bytes) : "48 MB";
  const version = info?.version && info.version !== "stub" ? ` v${info.version}` : "";
  const known = progress && progress.total > 0;
  const words = progress?.phase === "verifying" ? "Checking the download…" : progress?.phase === "extracting" ? "Unpacking the editor…" : known ? `Downloading ${Math.round(progress.done / 1_000_000)} MB of ${size}` : "Starting the download…";

  return (
    <Group title="Diagrams">
      <Row
        id="diagrams.editor"
        label={info?.installed ? "Diagram editor is installed" : "Diagram editor"}
        help={
          info?.installed
            ? "Kept in this app's own data folder; it never reaches the network."
            : `A ${size} download from GitHub, checked to be exactly the file KastenFlow expects before it is installed. Apache-2.0.`
        }
        detail={installing ? <span role="status">{words}</span> : info?.installed ? `Version${version || " for this computer"}` : `${size} download`}
      >
        {installing ? (
          <>
            <progress className="h-1.5 w-32" max={known ? progress.total : undefined} value={known ? progress.done : undefined} aria-label="Install progress" />
            <Button size="sm" onClick={() => void useDiagramEditor.getState().cancel()}>
              Cancel
            </Button>
          </>
        ) : info?.installed ? (
          desktop && (
            <Button size="sm" tone="danger" icon="trash" onClick={() => void useDiagramEditor.getState().remove()}>
              Remove
            </Button>
          )
        ) : desktop ? (
          <Button tone="primary" size="sm" icon="download" onClick={() => void useDiagramEditor.getState().install()}>
            {error ? "Try again" : `Install (${size})`}
          </Button>
        ) : (
          <span className="text-13 text-muted">Needs the desktop app</span>
        )}
      </Row>
      {error && <Note tone="danger">{error}</Note>}
      <Row id="diagrams.credit">
        <span className="text-13 text-muted">{EDITOR_CREDIT}</span>
      </Row>
    </Group>
  );
}
