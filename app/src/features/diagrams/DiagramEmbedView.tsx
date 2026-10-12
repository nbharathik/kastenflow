import "./diagrams.css";

import { useEffect } from "react";

import { Menu } from "../../shell/Menu";
import { IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useWorkspace } from "../workspace/store";
import { DiagramImage } from "./DiagramImage";
import { useDiagramEditor } from "./editor";
import { editDiagram, useDiagramHost } from "./host-store";
import { titleOfPath } from "./names";
import { copyPicture, exportPngFile, exportSvg } from "./picture";
import { useDiagrams } from "./store";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A diagram inside a page: its picture, centred, with a toolbar on hover (Edit, Open in a tab, Copy as image, Export) and a
 * double click to edit. The picture is an ordinary image, so nothing needs the editor to see it; a picture that is missing or out
 * of date is drawn again quietly while the editor is installed. */
export function DiagramEmbedView({ path }: { path: string }) {
  const client = useWorkspace((s) => s.client);
  const info = useDiagrams((s) => s.list.find((d) => d.path === path));
  const installed = useDiagramEditor((s) => s.info?.installed ?? false);
  const title = titleOfPath(path);

  useEffect(() => {
    if (!useDiagrams.getState().loaded) void useDiagrams.getState().load();
    if (!useDiagramEditor.getState().info) void useDiagramEditor.getState().refresh();
  }, []);

  useEffect(() => {
    if (installed && info && info.preview !== "fresh" && !info.problem) useDiagramHost.getState().redraw(path);
  }, [installed, info, path]);

  const tell = (err: unknown) => useWorkspace.getState().toast(message(err));
  const said = (what: string) => (where: string) => useWorkspace.getState().toast(`${what} ${where}`);
  const waiting = installed && info && info.preview !== "fresh" && !info.problem;

  return (
    <div className="kasten-diagram-embed-view group/diagram relative min-w-[min(100%,280px)] max-w-full" onDoubleClick={() => editDiagram(path)}>
      <DiagramImage
        path={path}
        alt={title}
        className="kasten-diagram-picture"
        fallback={
          <div className="flex min-h-28 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-panel px-4 py-6 text-center text-13 text-muted">
            <Icon name="diagram" className="size-4 shrink-0" />
            {info?.problem ? `This diagram cannot be read: ${info.problem}` : waiting ? "Drawing the picture…" : installed ? "No picture yet. Edit the diagram to draw it." : "No picture yet. Install the diagram editor to draw it."}
          </div>
        }
      />
      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-lg bg-canvas p-0.5 opacity-0 shadow-card transition-opacity focus-within:opacity-100 group-hover/diagram:opacity-100 motion-reduce:transition-none">
        <IconButton icon="edit" size="sm" label={`Edit ${title}`} onClick={() => editDiagram(path)} />
        <IconButton icon="open" size="sm" label={`Open ${title} in a tab`} onClick={() => useWorkspace.getState().openPath(path, "tab")} />
        <Menu
          label={`Export or copy ${title}`}
          buttonClass="ui-icon-btn is-sm"
          items={[
            { label: "Copy as image", icon: <Icon name="copy" className="size-4" />, onSelect: () => void copyPicture(client!, path).then(() => useWorkspace.getState().toast("Copied the picture"), tell) },
            { label: "Export as SVG", icon: <Icon name="download" className="size-4" />, onSelect: () => void exportSvg(client!, path).then(said("Saved"), tell) },
            { label: "Export as PNG", icon: <Icon name="image" className="size-4" />, onSelect: () => void exportPngFile(client!, path).then(said("Saved"), tell) },
          ]}
        >
          <Icon name="more" className="size-[15px]" />
        </Menu>
      </div>
    </div>
  );
}
