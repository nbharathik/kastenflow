import { beforeEach, describe, expect, it } from "vitest";

import { REQUEST_STALE_MS, requestBoardNode, takeBoardNode, usePlaceRequests } from "./place-requests";

beforeEach(() => usePlaceRequests.setState({ board: null }));

describe("requests for a board's node", () => {
  it("are taken once by the board they were for", () => {
    requestBoardNode("boards/a.canvas", "n1");
    expect(takeBoardNode("boards/other.canvas")).toBeNull();
    expect(usePlaceRequests.getState().board).not.toBeNull();
    expect(takeBoardNode("boards/a.canvas")).toMatchObject({ node: "n1" });
    expect(takeBoardNode("boards/a.canvas")).toBeNull();
  });

  it("go stale when no board takes them in time, and the newest replaces the one before", () => {
    requestBoardNode("boards/a.canvas", "n1");
    const asked = usePlaceRequests.getState().board!.at;
    expect(takeBoardNode("boards/a.canvas", asked + REQUEST_STALE_MS + 1)).toBeNull();
    expect(usePlaceRequests.getState().board).toBeNull();
    requestBoardNode("boards/a.canvas", "n1");
    requestBoardNode("boards/a.canvas", "n2");
    expect(takeBoardNode("boards/a.canvas")).toMatchObject({ node: "n2" });
  });
});
