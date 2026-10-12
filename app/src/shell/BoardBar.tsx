// The top bar on a whiteboard: where it lives, and its star and menu.

import { lazy, Suspense } from "react";

import { boardTitle, useBoards } from "../features/boards/store";
import { iconOf, titleOf } from "../features/workspace/names";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { projects } from "../features/workspace/tree";
import { Icon } from "../ui/Icon";
import { IconOrEmoji } from "../ui/IconOrEmoji";
import { Menu } from "./Menu";

const crumb = "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5";
const iconButton = "ui-icon-btn";

/** Loaded with the board it belongs to, not with the window. */
const MapChip = lazy(() => import("../features/boards/MapChip").then((m) => ({ default: m.MapChip })));

/** Whiteboards / its project / the board. */
export function BoardCrumbs({ path }: { path: string }) {
  const boards = useBoards((s) => s.list);
  const notes = useWorkspace((s) => s.notes);
  const folder = boards.find((b) => b.path === path)?.project ?? (path.startsWith("projects/") ? path.split("/")[1] : undefined);
  const project = folder ? projects(notes).find((p) => p.project === folder) : undefined;
  const { go, openPath } = useWorkspace.getState();
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5">
      <button type="button" onClick={() => go({ view: "boards" })} className={`${crumb} text-muted hover:bg-hover hover:text-ink`}>
        <Icon name="board" className="size-4" />
        <span className="truncate">Whiteboards</span>
      </button>
      <span className="text-muted/70">/</span>
      {project && (
        <>
          <button type="button" onClick={() => openPath(project.path)} className={`${crumb} text-muted hover:bg-hover hover:text-ink`}>
            <IconOrEmoji icon={iconOf(project)} />
            <span className="truncate">{titleOf(project)}</span>
          </button>
          <span className="text-muted/70">/</span>
        </>
      )}
      <span className={`${crumb} font-medium`}>
        <span className="truncate">{boardTitle(boards, path)}</span>
      </span>
    </nav>
  );
}

/** Star the board for the sidebar, open it again in a tab, or trash it; on a
 * page's map, bring it in step with the page. */
export function BoardActions({ path }: { path: string }) {
  const favourite = usePrefs((s) => s.favourites.includes(path));
  const { openPath, trash } = useWorkspace.getState();
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Suspense fallback={null}>
        <MapChip path={path} />
      </Suspense>
      <button
        type="button"
        aria-label={favourite ? "Remove from Favourites" : "Add to Favourites"}
        title={favourite ? "Remove from Favourites" : "Add to Favourites"}
        onClick={() => usePrefs.getState().toggleFavourite(path)}
        className={`${iconButton} ${favourite ? "text-favourite" : ""}`}
      >
        <Icon name="star" className={`size-4 ${favourite ? "fill-current" : ""}`} />
      </button>
      <Menu
        label="Board actions"
        buttonClass={iconButton}
        items={[
          { label: "Open in new tab", icon: <Icon name="external" className="size-4" />, onSelect: () => openPath(path, "tab") },
          { label: "All whiteboards", icon: <Icon name="board" className="size-4" />, onSelect: () => useWorkspace.getState().go({ view: "boards" }) },
          "divider",
          { label: "Move to Trash", icon: <Icon name="trash" className="size-4" />, danger: true, onSelect: () => void trash(path) },
        ]}
      >
        <Icon name="more" className="size-4" />
      </Menu>
    </div>
  );
}
