// A link to a card or a section of a board (`kasten:board/...?node=`): once
// the board is open, the node is selected and brought into view. Looking at
// a node changes nothing on the board.

import { useReactFlow } from "@xyflow/react";
import { useEffect } from "react";

import { usePlaceRequests, takeBoardNode } from "../../../workspace/place-requests";
import { useWorkspace } from "../../../workspace/store";
import type { BoardController } from "../state/controller";
import { select } from "../state/store";

export function useLinkedNode(board: BoardController): void {
  const flow = useReactFlow();
  const waiting = usePlaceRequests((s) => s.board?.path === board.path);
  useEffect(() => {
    if (!waiting) return;
    const request = takeBoardNode(board.path);
    if (!request) return;
    if (!board.node(request.node)) {
      useWorkspace.getState().toast("That part of the board is not there any more");
      return;
    }
    select(board.store, [request.node]);
    const frame = requestAnimationFrame(() => void flow.fitView({ nodes: [{ id: request.node }], padding: 0.3, maxZoom: 1, duration: 250 }));
    return () => cancelAnimationFrame(frame);
  }, [waiting, board, flow]);
}
