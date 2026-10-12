import { memo, useMemo, type DragEvent, type KeyboardEvent } from "react";

import { editorKeys } from "../../features/shortcuts/catalog";
import { homeItem } from "../../features/projects/home-menu";
import { setArchived } from "../../features/workspace/project-actions";
import { projectKey } from "../../features/workspace/project-order";
import type { NoteMeta } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { DROP_INTO } from "../drop-into";
import { TreeRow, type RowExtras } from "../PageTree";
import { PinMark } from "../PinMark";

/** What a row asks of its list; the same object for the list's life. */
export interface ListActions {
  /** Moves the row at `index` to `to`, within its group. */
  move(index: number, to: number): void;
  /** Pins or unpins a project; its row keeps focus as it moves. */
  pin(key: string): void;
  start(key: string, event: DragEvent): void;
  over(index: number, event: DragEvent<HTMLLIElement>): void;
  drop(index: number, event: DragEvent<HTMLLIElement>): void;
  leave(event: DragEvent<HTMLLIElement>): void;
  end(): void;
  keys(index: number, event: KeyboardEvent): void;
}

interface Props {
  note: NoteMeta;
  index: number;
  pinned: boolean;
  /** Whether it can move up or down: pinned projects move among the
   * pinned, the rest among the rest. */
  up: boolean;
  down: boolean;
  dragging: boolean;
  /** A dragged page would move into this project. */
  into: boolean;
  actions: ListActions;
}

/** A project in the list: a page row that also pins, moves and archives,
 * and takes pages dropped on it. */
export const ProjectRow = memo(function ProjectRow({ note, index, pinned, up, down, dragging, into, actions }: Props) {
  const key = projectKey(note);
  const extras = useMemo<RowExtras>(
    () => ({
      badge: pinned ? <PinMark /> : null,
      menu: [
        "divider",
        { label: pinned ? "Unpin" : "Pin to top", icon: <Icon name="pin" className="size-4" />, onSelect: () => actions.pin(key) },
        ...(up ? [{ label: "Move up", icon: <Icon name="chevron-up" className="size-4" />, hint: editorKeys("Alt+↑"), onSelect: () => actions.move(index, index - 1) }] : []),
        ...(down ? [{ label: "Move down", icon: <Icon name="chevron-down" className="size-4" />, hint: editorKeys("Alt+↓"), onSelect: () => actions.move(index, index + 1) }] : []),
        homeItem(note),
        { label: "Archive project", icon: <Icon name="archive" className="size-4" />, onSelect: () => void setArchived(note, true) },
      ],
      item: {
        "data-project": key,
        "data-drop-into": into ? "" : undefined,
        className: dragging ? "opacity-40" : into ? DROP_INTO : undefined,
        onDragOver: (e) => actions.over(index, e),
        onDrop: (e) => actions.drop(index, e),
        onDragLeave: (e) => actions.leave(e),
        onDragEnd: () => actions.end(),
      },
      onDragStart: (e) => actions.start(key, e),
      onKeyDown: (e) => actions.keys(index, e),
    }),
    [note, key, index, pinned, up, down, dragging, into, actions],
  );
  return <TreeRow note={note} extras={extras} />;
});
