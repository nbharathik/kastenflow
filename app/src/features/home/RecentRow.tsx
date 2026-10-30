// One row of Home's recent list: a small icon for the kind of thing, its
// title, the project it is in and when it last changed. Every row is the same
// height, whatever the title, so the list never jumps.

import type { KeyboardEvent } from "react";

import { viewTransition } from "../../lib/view-transition";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { openMenuHandlers } from "../../shell/open-menu";
import { howFrom, useWorkspace } from "../workspace/store";
import type { HomeItem, ItemType } from "./recent-items";
import { ago, agoLong } from "./when";

const KIND: Record<ItemType, string> = { page: "Page", card: "Card", board: "Whiteboard", deck: "Deck", diagram: "Diagram", capture: "Capture" };

export function RecentRow({ item, project, tab, onFocus }: { item: HomeItem; project: string | null; tab: boolean; onFocus(): void }) {
  const kind = KIND[item.type];
  const open = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Ctrl+Enter opens it in the pane to the right; Enter alone is the button's own click.
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    useWorkspace.getState().openPath(item.path, "right");
  };
  return (
    <li className="kasten-home-item" data-flip={item.path}>
      <button
        type="button"
        className="kasten-home-row"
        data-type={item.type}
        data-row=""
        tabIndex={tab ? 0 : -1}
        // The whole title first: the row cuts a long one with an ellipsis, and the tooltip shows on keyboard focus too.
        title={`${item.title}\n${kind}${project ? ` · ${project}` : ""} · ${agoLong(item.modified)}`}
        onClick={(event) => {
          const how = howFrom(event);
          const go = () => useWorkspace.getState().openPath(item.path, how);
          // Opening in this pane fades from Home to the page.
          if (how === "here") viewTransition(go);
          else go();
        }}
        onKeyDown={open}
        onFocus={onFocus}
        {...openMenuHandlers(item.path)}
      >
        <span className="kasten-home-row-icon">
          <IconOrEmoji icon={item.icon} />
        </span>
        <span className="kasten-home-row-title">{item.title}</span>
        <span className="sr-only">{kind}</span>
        <span className="kasten-home-row-meta">
          <span className="kasten-home-row-project">{project}</span>
          <span className="kasten-home-row-time">{ago(item.modified)}</span>
        </span>
      </button>
    </li>
  );
}

/** A row that holds its place while the vault is read. */
export function SkeletonRow() {
  return (
    <li className="kasten-home-item" aria-hidden="true">
      <span className="kasten-home-row is-skeleton">
        <span className="kasten-home-bone is-icon" />
        <span className="kasten-home-bone is-title" />
        <span className="kasten-home-bone is-time" />
      </span>
    </li>
  );
}
