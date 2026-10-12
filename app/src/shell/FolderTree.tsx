// Notes in folders that are not Kasten's own, as the folders they sit in:
// an Obsidian vault opened as it is keeps its shape. Folders
// come first, then notes; a folder opens on click, is remembered like the
// rows of the page tree, and opens by itself around the open page.

import { memo } from "react";

import type { FolderNode } from "../features/workspace/tree";
import { useWorkspace } from "../features/workspace/store";
import { Icon } from "../ui/Icon";
import { RowList, useExpanded } from "./PageTree";
import { useTreeFilter } from "./tree-filter";

export function FolderTree({ root }: { root: FolderNode }) {
  return (
    <>
      {root.folders.map((folder) => (
        <FolderRow key={folder.path} node={folder} depth={0} />
      ))}
    </>
  );
}

/** Whether a note in `node`, or in a folder inside it, is left by the filter. */
function hasMatch(node: FolderNode, show: ReadonlySet<string>): boolean {
  return node.notes.some((n) => show.has(n.path)) || node.folders.some((f) => hasMatch(f, show));
}

const FolderRow = memo(function FolderRow({ node, depth }: { node: FolderNode; depth: number }) {
  const holdsCurrent = useWorkspace((s) => s.place.view === "page" && Boolean(s.place.path?.startsWith(`${node.path}/`)));
  const filter = useTreeFilter();
  const matching = filter !== null && hasMatch(node, filter.show);
  const [open, toggle] = useExpanded(`folder:${node.path}`, holdsCurrent || matching);
  if (filter && !matching) return null;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        title={node.path}
        onClick={toggle}
        className="flex h-7 w-full items-center gap-1 rounded-md pr-2 text-left text-13 transition-colors hover:bg-hover"
        style={{ paddingLeft: `${4 + depth * 14}px` }}
      >
        <span className="grid size-5 shrink-0 place-items-center text-muted" aria-hidden="true">
          <Icon name="chevron" className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        </span>
        <span className="grid w-5 shrink-0 place-items-center text-muted" aria-hidden="true">
          <Icon name={open ? "folder-open" : "folder"} className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <span className="text-12 tabular-nums text-muted">{node.count}</span>
      </button>
      {open && (
        <ul>
          {node.folders.map((folder) => (
            <FolderRow key={folder.path} node={folder} depth={depth + 1} />
          ))}
          <RowList notes={node.notes} depth={depth + 1} listKey={`folder:${node.path}`} />
        </ul>
      )}
    </li>
  );
});
