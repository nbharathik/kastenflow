// What the find bar's "+ sub-pages" does in the workspace: looks through the
// page and its sub-pages with the core's `find_under`, replaces with
// `replace_under` (one commit, after the open pages are written), opens a
// result with the find bar on the same text, and offers Undo for the commit.

import type { VaultClient } from "../../../lib/vault/types";
import { showOpenMenu } from "../../../shell/open-menu";
import type { SubPageFind } from "../../pages/editor/find/sub-pages";
import { linkOpens } from "../open-how";
import { howFromName, useWorkspace } from "../store";
import { writeEverything } from "./before-exit";
import { openAt } from "./jump";
import { flushOpenPage, reloadOpenPage } from "./open-page";

const noun = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** `path()` is the page the find bar is on, which the search roots at. */
export function subPageFind(client: VaultClient, path: () => string): SubPageFind {
  /** Pages open on a changed note show the new text, and the lists catch up. */
  const reloaded = async (paths: readonly string[]) => {
    for (const changed of paths) reloadOpenPage(changed);
    await useWorkspace.getState().refresh();
  };

  return {
    // The page being typed in is written first, so what is found is what is on disk.
    find: async (spec, max) => {
      await flushOpenPage();
      return client.findUnder(path(), spec, max);
    },

    replace: async (request) => {
      // Every open page and any waiting edit first, so the replace is a commit of its own.
      await writeEverything();
      const done = await client.replaceUnder({ root: path(), ...request });
      const changed = done.notes.map(([notePath]) => notePath);
      await reloaded(changed);
      const { toast } = useWorkspace.getState();
      const text = `Replaced ${noun(done.total, "match", "matches")} in ${noun(done.notes.length, "page", "pages")}`;
      const commit = done.commit;
      toast(
        text,
        commit
          ? {
              label: "Undo",
              run: () => {
                void client.undoCommit(commit).then(
                  async (undone) => {
                    if (undone.conflict) return toast(`Not undone: ${undone.conflict.path} changed since (${undone.conflict.detail.toLowerCase()}).`);
                    await reloaded(changed);
                    toast("Undid the replace");
                  },
                  (err: unknown) => toast(err instanceof Error ? err.message : String(err)),
                );
              },
            }
          : undefined,
      );
      return done;
    },

    open: (target, query, how) => openAt(target, { find: [query] }, how && how !== "here" ? howFromName(how) : linkOpens(path())),

    openMenu: (event, target) => {
      showOpenMenu(event, target);
      return true;
    },

    rename: (target, title) => void useWorkspace.getState().rename(target, title),
  };
}
