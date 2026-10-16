// What a page's editor knows about whiteboards, for `![[board.canvas]]`
// embeds and /whiteboard: the boards to pick from, making one in
// the page's project, drawing one live inside the page, and opening one.

import { createRoot } from "react-dom/client";

import type { NoteMeta, VaultClient } from "../../../lib/vault/types";
import { ViewBoundary } from "../../../ui/ViewBoundary";
import { LazyBoard } from "../../boards/canvas/LazyBoard";
import { projectTitle, useBoards } from "../../boards/store";
import { UpdatedBadge } from "../../health/UpdatedBadge";
import type { LinkProvider } from "../../pages/editor/links";
import { useWorkspace } from "../store";

type BoardLinks = Required<Pick<LinkProvider, "boards" | "createBoard" | "mountBoard" | "openBoard">>;

export function boardLinks(client: VaultClient, page: () => NoteMeta | undefined): BoardLinks {
  return {
    boards: () => {
      const notes = useWorkspace.getState().notes;
      return [...useBoards.getState().list]
        .sort((a, b) => b.modified - a.modified)
        .map((b) => ({ path: b.path, title: b.title, hint: b.project ? projectTitle(notes, b.project) : undefined }));
    },
    createBoard: async (title) => {
      try {
        const path = await client.createBoard(title, page()?.project ?? null);
        await useBoards.getState().load();
        return path;
      } catch (err) {
        useWorkspace.getState().toast(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    mountBoard: (host, path, options) => {
      const root = createRoot(host);
      root.render(
        <ViewBoundary place={path}>
          <LazyBoard path={path} embedded={options?.embedded ?? false} />
          <UpdatedBadge kind="board" path={path} />
        </ViewBoundary>,
      );
      return () => root.unmount();
    },
    openBoard: (path, how) => useWorkspace.getState().openPath(path, how),
  };
}
