import { useEffect, useRef, useState } from "react";

import { Menu } from "../../shell/Menu";
import { IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useWorkspace } from "../workspace/store";
import { DiagramImage } from "./DiagramImage";
import { DrawioFrame } from "./DrawioFrame";
import { InstallNotice } from "./InstallNotice";
import { useDiagramEditor } from "./editor";
import { copyPng, downloadPng, downloadSvg } from "./exports";
import { titleOfPath } from "./names";
import type { EditorUi } from "./protocol";
import type { DrawioSession, EditorStatus } from "./session";
import { diagramChanged, useDiagrams } from "./store";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The line beside the title: how the diagram stands. */
export function statusWords(status: EditorStatus | null): string {
  switch (status?.kind) {
    case "loading":
      return "Starting the editor…";
    case "unsaved":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "copy":
      return `Saved as a copy: ${titleOfPath(status.path)}`;
    case "error":
      return `Not saved: ${status.message}`;
    default:
      return "";
  }
}

interface EditorProps {
  path: string;
  /** The session now writes another file (a copy, after a conflict): the tab follows it. */
  onMoved?(path: string): void;
  /** In a modal: close it. */
  onClose?(): void;
  /** In a modal: open the diagram in a tab of its own instead. */
  onOpenInTab?(path: string): void;
  ui?: EditorUi;
}

/** A diagram in the editor, with its title, how it stands, and the ways to take it out. The editor itself is an optional
 * download: while it is not installed the picture is shown, with the offer to install it. */
export function DiagramEditor({ path, onMoved, onClose, onOpenInTab, ui }: EditorProps) {
  const client = useWorkspace((s) => s.client);
  const info = useDiagramEditor((s) => s.info);
  const [file, setFile] = useState<{ path: string; xml: string; hash: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<EditorStatus | null>(null);
  const session = useRef<DrawioSession | null>(null);
  // The file the editor is writing: the one asked for, or the copy a conflict made, which the tab follows.
  const current = useRef("");

  useEffect(() => {
    if (!info) void useDiagramEditor.getState().refresh();
  }, [info]);

  useEffect(() => {
    if (!client || path === current.current) return;
    let gone = false;
    setFile(null);
    setProblem(null);
    setStatus(null);
    client.diagram(path).then(
      (read) => {
        if (gone) return;
        current.current = read.path;
        setFile({ path: read.path, xml: read.xml, hash: read.hash });
      },
      (err) => {
        if (!gone) setProblem(message(err));
      },
    );
    return () => {
      gone = true;
    };
  }, [client, path]);

  // A new diagram made "from a template" asks for the editor's dialog once the editor is ready.
  const wantsTemplates = useDiagrams((s) => s.templateFor === current.current && current.current !== "");
  useEffect(() => {
    if (status?.kind !== "ready" || !wantsTemplates) return;
    useDiagrams.setState({ templateFor: null });
    session.current?.showTemplates();
  }, [status, wantsTemplates]);

  const tell = (err: unknown) => useWorkspace.getState().toast(message(err));
  const shown = current.current || file?.path || path;
  const title = titleOfPath(shown);
  const installed = info?.installed ?? false;

  return (
    <div className="kasten-diagram-editor">
      <div className="flex min-h-11 items-center gap-2 border-b border-line px-3 py-1.5">
        <Icon name="diagram" className="size-4 shrink-0 text-muted" />
        <h1 className="min-w-0 truncate text-14 font-medium">{title}</h1>
        <span role="status" aria-live="polite" className={`min-w-0 truncate text-12 ${status?.kind === "error" ? "text-danger" : "text-muted"}`}>
          {statusWords(status)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Menu
            label={`Export or copy ${title}`}
            buttonClass="ui-icon-btn"
            items={[
              { label: "Export as SVG", icon: <Icon name="download" className="size-4" />, onSelect: () => void downloadSvg(client!, shown, session.current).then((where) => useWorkspace.getState().toast(`Saved ${where}`), tell) },
              ...(installed
                ? [
                    { label: "Export as PNG", icon: <Icon name="image" className="size-4" />, onSelect: () => void (session.current ? downloadPng(client!, shown, session.current).then((where) => useWorkspace.getState().toast(`Saved ${where}`), tell) : Promise.resolve()) },
                    { label: "Copy as image", icon: <Icon name="copy" className="size-4" />, onSelect: () => void (session.current ? copyPng(session.current).then(() => useWorkspace.getState().toast("Copied the picture"), tell) : Promise.resolve()) },
                  ]
                : []),
              "divider",
              { label: "Copy embed for a page", icon: <Icon name="link" className="size-4" />, hint: "![[…]]", onSelect: () => void navigator.clipboard?.writeText(`![[${shown.slice(shown.lastIndexOf("/") + 1)}]]`).then(() => useWorkspace.getState().toast("Copied the embed"), tell) },
            ]}
          >
            <Icon name="more" className="size-[17px]" />
          </Menu>
          {onOpenInTab && <IconButton icon="open" label="Open in a tab" onClick={() => onOpenInTab(shown)} />}
          {onClose && <IconButton icon="close" label="Close" onClick={onClose} />}
        </div>
      </div>
      {!installed && <InstallNotice className="m-3" />}
      <div className="kasten-diagram-stage">
        {problem ? (
          <p role="alert" className="p-6 text-14 text-danger">
            This diagram cannot be opened: {problem}
          </p>
        ) : !file ? null : installed ? (
          <DrawioFrame
            file={file}
            title={`${title}: diagram editor`}
            ui={ui}
            onSession={(next) => {
              session.current = next;
            }}
            onStatus={(next) => {
              setStatus(next);
              if (next.kind === "saved") diagramChanged(current.current);
            }}
            onMoved={(copy) => {
              current.current = copy;
              onMoved?.(copy);
            }}
          />
        ) : (
          <div className="grid h-full place-items-center overflow-auto p-6">
            <DiagramImage path={file.path} alt={title} className="kasten-diagram-picture" fallback={<p className="text-14 text-muted">This diagram has no picture yet. Install the editor to draw it.</p>} />
          </div>
        )}
      </div>
    </div>
  );
}
