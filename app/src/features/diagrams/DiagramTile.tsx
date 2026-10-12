import { memo, useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";

import { relativeTime } from "../../lib/dates";
import type { DiagramInfo } from "../../lib/vault/types";
import { Menu, type MenuItem } from "../../shell/Menu";
import { openMenuHandlers } from "../../shell/open-menu";
import { Icon } from "../../ui/Icon";
import { dragNotes } from "../workspace/drag";
import { howFrom, useWorkspace } from "../workspace/store";
import { DiagramImage } from "./DiagramImage";
import { duplicateDiagram, moveDiagram } from "./actions";

/** A project to move a diagram to. */
export interface Place {
  folder: string | null;
  title: string;
}

export interface TileProps {
  info: DiagramInfo;
  layout: "grid" | "list";
  places: readonly Place[];
  onRename(info: DiagramInfo): void;
}

/** True once the element has come near the screen: a picture is read only for a tile that is about to be seen. */
function useNear(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (near || !element) return;
    const watch = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "200px" });
    watch.observe(element);
    return () => watch.disconnect();
  }, [near]);
  return [ref, near];
}

const pages = (n: number) => (n === 1 ? "1 page" : `${n} pages`);

/** One diagram in the Diagrams view, as a card with its picture or as a row. */
export const DiagramTile = memo(function DiagramTile({ info, layout, places, onRename }: TileProps) {
  const [ref, near] = useNear();
  const { openPath, trash } = useWorkspace.getState();
  const detail = info.problem ? "Cannot be read" : `${pages(info.pages)} · ${relativeTime(info.modified)}`;
  const items: (MenuItem | "divider")[] = [
    { label: "Open", icon: <Icon name="open" className="size-4" />, onSelect: () => openPath(info.path, "here") },
    { label: "Open in new tab", icon: <Icon name="external" className="size-4" />, hint: "Ctrl+click", onSelect: () => openPath(info.path, "tab") },
    "divider",
    { label: "Rename…", icon: <Icon name="edit" className="size-4" />, onSelect: () => onRename(info) },
    { label: "Duplicate", icon: <Icon name="copy" className="size-4" />, onSelect: () => void duplicateDiagram(info.path) },
    ...places
      .filter((p) => p.folder !== info.project)
      .map((p): MenuItem => ({ label: `Move to ${p.title}`, icon: <Icon name="move-to" className="size-4" />, onSelect: () => void moveDiagram(info.path, p.folder, p.title) })),
    { label: "Copy embed for a page", icon: <Icon name="link" className="size-4" />, hint: "![[…]]", onSelect: () => void navigator.clipboard?.writeText(`![[${info.path.slice(info.path.lastIndexOf("/") + 1)}]]`) },
    "divider",
    { label: "Move to Trash", icon: <Icon name="trash" className="size-4" />, danger: true, onSelect: () => void trash(info.path) },
  ];
  const open = (event: MouseEvent) => openPath(info.path, howFrom(event));
  const menu = (
    <Menu label={`More for ${info.title}`} buttonClass="grid size-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink" items={items} float>
      <Icon name="more" className="size-4" />
    </Menu>
  );

  if (layout === "list") {
    return (
      <div className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover" draggable onDragStart={(e) => dragNotes(e, [info.path])} {...openMenuHandlers(info.path)}>
        <button type="button" aria-label={`Open ${info.title}`} onClick={open} className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          <Icon name="diagram" className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-14">{info.title}</span>
          <span className="hidden w-44 truncate text-12 text-muted sm:block">{info.project ?? "Library"}</span>
          <span className={`w-44 truncate text-12 ${info.problem ? "text-danger" : "text-muted"}`}>{detail}</span>
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      draggable
      onDragStart={(e) => dragNotes(e, [info.path])}
      {...openMenuHandlers(info.path)}
      className="group relative overflow-hidden rounded-xl border border-line bg-canvas shadow-card transition ease-standard hover:border-line-hover hover:shadow-hover motion-reduce:transition-none"
    >
      <button type="button" aria-label={`Open ${info.title}`} onClick={open} className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <div className="border-b border-line bg-panel/70 p-3">
          <div className="kasten-diagram-thumb border border-line">
            {near && <DiagramImage path={info.path} alt="" fallback={<Icon name="diagram" className="size-8 text-muted" />} />}
          </div>
        </div>
        <div className="px-3.5 pb-3 pt-2.5">
          <div className="truncate text-14 font-semibold">{info.title}</div>
          <div className={`mt-0.5 text-12 ${info.problem ? "text-danger" : "text-muted"}`}>{detail}</div>
        </div>
      </button>
      <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-canvas p-0.5 opacity-0 shadow-card transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">{menu}</div>
    </div>
  );
});
