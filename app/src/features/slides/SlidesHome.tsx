import { type KeyboardEvent, useEffect, useMemo, useState } from "react";

import { projectTitle } from "../boards/store";
import { useWorkspace } from "../workspace/store";
import { ContinueRow } from "./ContinueRow";
import { DeckGrid } from "./DeckGrid";
import { DeckToolbar } from "./DeckToolbar";
import { type DeckSort, filterDecks, sortDecks, writeSort } from "./deck-sort";
import { EmptyDecks } from "./EmptyDecks";
import { HomeHeader } from "./HomeHeader";
import { type DeckView, inProject, projectKeys, readHomeSort, readView, writeView } from "./home-prefs";
import { NewDeck } from "./NewDeck";
import { StartRow } from "./StartRow";
import { useDecks } from "./store";
import "./home.css";

/**
 * The Slides view: the decks to continue, the ways to start one, and every deck as cards or rows, found by words, by project and ordered
 * by when they were edited or by name. Ctrl+N starts a deck while the view has the keys.
 */
export function SlidesHome() {
  const list = useDecks((s) => s.list);
  const loaded = useDecks((s) => s.loaded);
  const creating = useDecks((s) => s.creating);
  const draftProject = useDecks((s) => s.draftProject);
  const notes = useWorkspace((s) => s.notes);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DeckSort>(readHomeSort);
  const [view, setView] = useState<DeckView>(readView);
  const [project, setProject] = useState<string | null>(null);
  useEffect(() => void useDecks.getState().load(), []);

  const projects = useMemo(() => projectKeys(list).map((key) => ({ key, title: projectTitle(notes, key) })).sort((a, b) => a.title.localeCompare(b.title)), [list, notes]);
  // A project chosen earlier that no deck is in any more is no filter.
  const chosen = project && !projects.some((choice) => choice.key === project) ? null : project;
  const found = useMemo(() => filterDecks(inProject(list, chosen), notes, query), [list, notes, chosen, query]);
  const shown = useMemo(() => sortDecks(found, sort), [found, sort]);

  const start = () => useDecks.setState({ creating: true, draftProject: null });
  const chooseSort = (next: DeckSort) => {
    setSort(next);
    writeSort(next);
  };
  const chooseView = (next: DeckView) => {
    setView(next);
    writeView(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "n" || creating) return;
    // Before the app's own Ctrl+N, which makes a page.
    event.preventDefault();
    start();
  };

  return (
    <div className="sh-home mx-auto max-w-[1120px] px-4 pb-24 pt-8 sm:px-6 sm:pt-10" onKeyDown={onKeyDown}>
      <HomeHeader query={query} onQuery={setQuery} onNew={start} searchable={list.length > 0} />

      {!creating && <ContinueRow />}

      {creating ? <NewDeck key={draftProject ?? ""} /> : <StartRow onGallery={start} />}

      {loaded && list.length === 0 && !creating && <EmptyDecks />}

      {list.length > 0 && <DeckToolbar count={shown.length} sort={sort} onSort={chooseSort} view={view} onView={chooseView} projects={projects} project={chosen} onProject={setProject} />}

      {query.trim() && found.length === 0 && <p className="mt-10 text-center text-14 text-muted">No deck is called “{query.trim()}”.</p>}
      {!query.trim() && list.length > 0 && found.length === 0 && <p className="mt-10 text-center text-14 text-muted">No deck is in this project yet.</p>}

      {shown.length > 0 && (
        <div className="mt-3">
          <DeckGrid decks={shown} view={view} label="Decks" />
        </div>
      )}
    </div>
  );
}
