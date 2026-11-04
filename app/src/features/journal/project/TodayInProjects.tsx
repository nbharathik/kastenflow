// "Today in projects": the projects that have a journal note on a vault day,
// as chips under it. Computed from the index each time it shows; nothing is
// written into the person's day. Its own chunk, fetched with the first vault day.

import "./project-journal.css";

import { useEffect, useState } from "react";

import { dayFrom } from "../../../lib/dates";
import type { ProjectJournalRef } from "../../../lib/vault/types";
import { howFrom, useWorkspace } from "../../workspace/store";

export default function TodayInProjects({ day }: { day: string }) {
  const client = useWorkspace((s) => s.client);
  // A day's project notes appear in the list as they are made.
  const notes = useWorkspace((s) => s.notes.length);
  const [refs, setRefs] = useState<ProjectJournalRef[]>([]);

  useEffect(() => {
    if (!client) return;
    let current = true;
    client
      .projectJournalsOn(day)
      .then((found) => current && setRefs(found))
      // A strip nobody asked for: when the list cannot be read it is left out, and the day reads as before.
      .catch(() => current && setRefs([]));
    return () => {
      current = false;
    };
  }, [client, day, notes]);

  if (refs.length === 0) return null;
  return (
    <nav className="kasten-today-projects" aria-label="Today in projects">
      <span>{day === dayFrom() ? "Today in projects" : "In projects"}</span>
      {refs.map((ref) => (
        <button type="button" key={ref.path} onClick={(event) => useWorkspace.getState().openPath(ref.path, howFrom(event))}>
          {ref.projectTitle}
        </button>
      ))}
    </nav>
  );
}
