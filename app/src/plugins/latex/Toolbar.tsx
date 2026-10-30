// The editor's toolbar: show or hide the files, the document's name, the
// auto-build switch, and Build (Stop while it builds), Export PDF and Sync to
// PDF. Every button is named, reachable with Tab, and also in the palette.

import { isMac } from "../../features/shortcuts/keymap";
import { Button, IconButton } from "../../ui/Button";

const MOD = () => (isMac() ? "Cmd" : "Ctrl");

interface Props {
  title: string;
  folder: string;
  filesOpen: boolean;
  auto: boolean;
  building: boolean;
  hasPdf: boolean;
  onFiles(): void;
  onAuto(on: boolean): void;
  onBuild(): void;
  onStop(): void;
  onExport(): void;
  onSync(): void;
  /** Opens the list of references to cite. */
  onCite?(): void;
  /** Opens the inline AI panel at the caret. */
  onAsk?(): void;
}

export function Toolbar({ title, folder, filesOpen, auto, building, hasPdf, onFiles, onAuto, onBuild, onStop, onExport, onSync, onCite, onAsk }: Props) {
  return (
    <div className="latex-toolbar" role="toolbar" aria-label="LaTeX document">
      <IconButton icon="sidebar" label={filesOpen ? "Hide the files" : "Show the files"} active={filesOpen} onClick={onFiles} />
      <span className="latex-title" title={folder}>
        {title}
      </span>
      <label className="latex-auto" title="Build a moment after you stop typing">
        <input type="checkbox" role="switch" checked={auto} onChange={(e) => onAuto(e.target.checked)} aria-label="Auto-build" />
        <span className="latex-track" aria-hidden="true" />
        Auto-build
      </label>
      {onCite && (
        <Button icon="book" onClick={onCite} title="Insert a citation from your references">
          Cite
        </Button>
      )}
      {onAsk && (
        <Button icon="wand" onClick={onAsk} title={`Ask AI to write or rewrite at the cursor (${MOD()}+K). Its answer may be wrong: you keep or undo it.`}>
          Ask AI
        </Button>
      )}
      {building && (
        <Button icon="stop" onClick={onStop} title="Stop the build">
          Stop
        </Button>
      )}
      <Button tone="primary" icon="refresh" onClick={onBuild} title={`Build (${MOD()}+Enter)`}>
        Build
      </Button>
      <Button icon="download" disabled={!hasPdf} onClick={onExport} title={hasPdf ? "Keep the PDF in the document's folder" : "Build the document first"}>
        Export PDF
      </Button>
      <Button icon="pointer" disabled={!hasPdf} onClick={onSync} title={hasPdf ? "Show the line you are on in the PDF" : "Build the document first"}>
        Sync to PDF
      </Button>
    </div>
  );
}
