import "@xyflow/react/dist/base.css";
import "./styles/canvas.css";
import "./styles/nodes.css";
import "./styles/items.css";
import "./styles/far.css";
import "./styles/bars.css";
import "./styles/menus.css";
import "./styles/chrome.css";
import "./styles/drawing.css";
import "./styles/present.css";

import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";

import type { VaultClient } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";
import { Canvas } from "./Canvas";
import { BoardContext } from "./context";
import { BoardController, type BoardDeps } from "./state/controller";
import { leaseBoard } from "./state/registry";
import { entered } from "./trail";

/** What the board at `path` uses from the rest of the app. */
export function boardDeps(client: VaultClient, path: string): BoardDeps {
  const workspace = () => useWorkspace.getState();
  return {
    client,
    notes: () => workspace().notes,
    toast: (text) => workspace().toast(text),
    open: (file, how) => workspace().openPath(file, how),
    create: (draft) => workspace().create(draft, false),
    trash: async (file) => void (await workspace().trash(file)),
    enter: (child) => {
      entered(path, child);
      workspace().go({ view: "boards", path: child });
    },
  };
}

/** An open board's canvas. `embedded`: it is shown inside a page. */
export function BoardView({ board, embedded = false }: { board: BoardController; embedded?: boolean }) {
  return (
    <BoardContext.Provider value={board}>
      <ReactFlowProvider>
        <Canvas embedded={embedded} />
      </ReactFlowProvider>
    </BoardContext.Provider>
  );
}

/** A whiteboard: an infinite canvas of cards,
 * stickies, sections, links, images and nested boards, joined by edges. */
export function BoardCanvas({ path, embedded = false }: { path: string; embedded?: boolean }) {
  const client = useWorkspace((s) => s.client);
  const [board, setBoard] = useState<BoardController | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    // The tab and every page that shows this board share one controller, so undo survives a remount.
    const lease = leaseBoard(path, async () => new BoardController(path, await client.board(path), boardDeps(client, path)), client);
    lease.board.then(
      (shared) => {
        if (!live) return;
        setBoard(shared);
        void shared.refresh();
      },
      (err: unknown) => live && setProblem(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
      lease.release();
    };
  }, [client, path]);
  if (problem) {
    return (
      <section className="mx-auto mt-24 max-w-md px-6 text-center">
        <h1 className="text-20 font-semibold">This board could not be opened</h1>
        <p className="mt-2 text-14 text-muted">{problem}</p>
      </section>
    );
  }
  if (!board) return <div className="grid h-full place-items-center text-13 text-muted">Opening the board…</div>;
  return <BoardView board={board} embedded={embedded} />;
}
