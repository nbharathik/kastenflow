// Asks a view to show a spot once it is open: a board to bring a card or a
// section into view. The request waits here until the board that was asked
// for takes it; one left waiting too long goes stale and is dropped.

import { create } from "zustand";

export interface BoardNodeRequest {
  path: string;
  /** The node's id on the board. */
  node: string;
  at: number;
}

/** How long a request waits for its view. */
export const REQUEST_STALE_MS = 10_000;

export const usePlaceRequests = create<{ board: BoardNodeRequest | null }>(() => ({ board: null }));

/** Asks the board at `path` to bring `node` into view and select it. */
export function requestBoardNode(path: string, node: string): void {
  usePlaceRequests.setState({ board: { path, node, at: Date.now() } });
}

/** Takes the request for the board at `path`, if one is waiting and fresh. */
export function takeBoardNode(path: string, now = Date.now()): BoardNodeRequest | null {
  const request = usePlaceRequests.getState().board;
  if (!request || request.path !== path) return null;
  usePlaceRequests.setState({ board: null });
  return now - request.at > REQUEST_STALE_MS ? null : request;
}
