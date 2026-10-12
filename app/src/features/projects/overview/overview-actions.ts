// What the overview writes to the vault: its saved tables go into the project
// page's `overview` property through the core's update_props (one commit each),
// in order, so two quick changes never write over each other; new pages and
// cards are made in the project's folder. The tables are shown at once from
// what the person did, and corrected from the page's own properties if a write
// fails.

import { useCallback, useEffect, useRef, useState } from "react";

import type { NoteMeta } from "../../../lib/vault/types";
import { writeProps } from "../../calendar/write";
import { useWorkspace } from "../../workspace/store";
import { overviewProp, readOverview, type Overview } from "./overview";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The overview of `project`, and a way to change it: kept in step with the page's properties, and written in order. */
export function useSavedOverview(project: NoteMeta): [Overview, (next: Overview) => Promise<void>] {
  const fromPage = project.props.overview;
  const stamp = JSON.stringify(fromPage ?? null);
  const [overview, setOverview] = useState<Overview>(() => readOverview(project.props));
  const writing = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(project);
  useEffect(() => {
    latest.current = project;
  });

  // Another window, an agent or an undo changed the property: follow it, unless a write of ours is still on its way.
  useEffect(() => {
    if (writing.current === 0) setOverview(readOverview(latest.current.props));
  }, [stamp]);

  const save = useCallback(async (next: Overview) => {
    setOverview(next);
    writing.current++;
    const run = chain.current.then(async () => {
      const { client, noteChanged, toast } = useWorkspace.getState();
      if (!client) return;
      try {
        const saved = await writeProps(client, latest.current.path, { overview: overviewProp(next) });
        noteChanged(saved.meta);
      } catch (err) {
        toast(`The saved tables could not be written: ${message(err)}`);
        setOverview(readOverview(latest.current.props));
      }
    });
    chain.current = run;
    await run;
    writing.current--;
  }, []);

  return [overview, save];
}

/** A new page called `title` in the project's folder, not opened (a table lists it); null, with a notice, if it could not be made. */
export async function makeProjectPage(folder: string, title: string): Promise<NoteMeta | null> {
  const made = await useWorkspace.getState().create({ kind: "page", title, project: folder }, false);
  return made?.meta ?? null;
}
