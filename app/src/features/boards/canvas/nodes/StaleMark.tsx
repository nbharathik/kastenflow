// The mark on a mind-map branch whose line has left its page: the branch
// stays, dimmed, and says so, with a one-click way to take it off.

import { Icon } from "../../../../ui/Icon";
import { removeBranch } from "../../map-actions";
import { useBoard, useBoardState } from "../context";

/** Whether this node is a branch whose line is not in the page any more. */
export function useStale(id: string): boolean {
  return useBoardState((s) => s.doc.source?.branches?.[id]?.stale === true);
}

export function StaleMark({ id }: { id: string }) {
  const board = useBoard();
  return (
    <div className="kasten-stale-mark nodrag nopan">
      <span>Not in the page any more</span>
      <button
        type="button"
        aria-label="Remove this branch from the map"
        title="Remove this branch"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          void removeBranch(board, id);
        }}
      >
        <Icon name="close" className="size-3" />
      </button>
    </div>
  );
}
