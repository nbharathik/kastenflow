// Top left: the way here, quietly. Whiteboards, then the boards you came
// through to reach this nested one, then this board's title.

import { Icon } from "../../../../ui/Icon";
import { useWorkspace } from "../../../workspace/store";
import { boardTitle, useBoards } from "../../store";
import { useBoard, useBoardState } from "../context";
import { trailOf } from "../trail";

export function Breadcrumb() {
  const board = useBoard();
  const title = useBoardState((s) => s.doc.title);
  const list = useBoards((s) => s.list);
  const way = trailOf(board.path);
  return (
    <nav className="kasten-chrome kasten-crumbs" aria-label="Board breadcrumb">
      <button type="button" className="kasten-crumb is-root" onClick={() => useWorkspace.getState().go({ view: "boards" })} title="All whiteboards">
        <Icon name="board" className="size-4" />
      </button>
      {way.map((path) => (
        <span key={path} className="contents">
          <span className="kasten-crumb-sep" aria-hidden="true">
            /
          </span>
          <button type="button" className="kasten-crumb" onClick={() => board.deps.enter(path)}>
            {boardTitle(list, path)}
          </button>
        </span>
      ))}
      <span className="kasten-crumb-sep" aria-hidden="true">
        /
      </span>
      <span className="kasten-crumb is-current" aria-current="page">
        {title}
      </span>
    </nav>
  );
}
