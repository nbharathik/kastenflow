// The sections of a project's home, each a card of the dashboard.

import { lazy, Suspense, useMemo, useState } from "react";

import { relativeTime } from "../../lib/dates";
import type { NoteMeta } from "../../lib/vault/types";
import { IconButton } from "../../ui/Button";
import { showBoardsOf, useBoards } from "../boards/store";
import { DashCard, DashEmpty, MoreToggle } from "../dashboard/DashCard";
import { MiniList, SeeAll } from "../dashboard/Minis";
import { BoardMini, DeckMini, NoteRow } from "../dashboard/NoteTiles";
import { TodoList } from "../dashboard/TodoList";
import { startNewDeck, useDecks } from "../slides/store";
import { titleOf } from "../workspace/names";
import { useWorkspace } from "../workspace/store";
import { Capture } from "../workspace/views/Capture";
import type { ProjectSection as SectionId } from "./home";
import { newBoard, newPage } from "./home-actions";
import { inFolder, partsOf, type ProjectParts } from "./project-data";
import { ProjectSummary } from "./ProjectSummary";

const ProjectKanban = lazy(() => import("./ProjectKanban").then((m) => ({ default: m.ProjectKanban })));

interface SectionProps {
  id: SectionId;
  project: NoteMeta;
  folder: string;
}

/** The project's parts, recomputed when its notes or boards change. */
function useParts(project: NoteMeta): ProjectParts {
  const notes = useWorkspace((s) => s.notes);
  const boards = useBoards((s) => s.list);
  const decks = useDecks((s) => s.list);
  return useMemo(() => partsOf(notes, boards, project, decks), [notes, boards, project, decks]);
}

export function ProjectSection({ id, project, folder }: SectionProps) {
  const parts = useParts(project);
  switch (id) {
    case "summary":
      return <ProjectSummary project={project} parts={parts} />;
    case "capture":
      return <QuickNote folder={folder} />;
    case "todo":
      return <Todos project={project} folder={folder} />;
    case "recent":
      return <Recent parts={parts} />;
    case "pages":
      return <Pages parts={parts} folder={folder} />;
    case "cards":
      return <Cards parts={parts} />;
    case "boards":
      return <Boards parts={parts} folder={folder} title={titleOf(project)} />;
    case "decks":
      return <Decks parts={parts} folder={folder} />;
    case "kanban":
      return (
        <Suspense fallback={<DashCard title="Task board" icon="kanban"><DashEmpty>Opening the board…</DashEmpty></DashCard>}>
          <ProjectKanban folder={folder} />
        </Suspense>
      );
  }
}

/** A thought caught into the project as a card, with the same box as
 * Home's and the Inbox's; Recently edited lists it. */
function QuickNote({ folder }: { folder: string }) {
  return (
    <DashCard title="Quick note" icon="zap" plain>
      <Capture project={folder} label="Quick note for this project" className="" />
    </DashCard>
  );
}

function Todos({ project, folder }: { project: NoteMeta; folder: string }) {
  const filter = useMemo(() => inFolder(folder), [folder]);
  return (
    <DashCard title="To-dos" icon="tasks">
      <TodoList filter={filter} addTo={project.path} home={project.path} empty="Nothing to do here. Add a to-do above, or type [] on any page of the project." />
    </DashCard>
  );
}

function Recent({ parts }: { parts: ProjectParts }) {
  return (
    <DashCard title="Recently edited" icon="clock">
      {parts.recent.length === 0 ? (
        <DashEmpty>Pages and cards you write in this project show up here.</DashEmpty>
      ) : (
        <div className="kasten-dash-rows">
          {parts.recent.slice(0, 6).map((note) => (
            <NoteRow key={note.path} note={note} />
          ))}
        </div>
      )}
    </DashCard>
  );
}

function Pages({ parts, folder }: { parts: ProjectParts; folder: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? parts.top : parts.top.slice(0, 8);
  return (
    <DashCard
      title="Pages"
      icon="page"
      count={parts.pages.length}
      actions={
        <>
          {parts.top.length > 1 && (
            <IconButton icon="layers" label="Open these pages in tabs" size="sm" onClick={() => useWorkspace.getState().openTabs(parts.top.map(({ note }) => ({ view: "page" as const, path: note.path })))} />
          )}
          <IconButton icon="plus" label="New page in this project" size="sm" onClick={() => newPage(folder)} />
        </>
      }
    >
      {parts.top.length === 0 ? (
        <DashEmpty>No pages yet. The + makes one in this project.</DashEmpty>
      ) : (
        <div className="kasten-dash-rows">
          {shown.map(({ note, children }) => (
            <NoteRow key={note.path} note={note} detail={children > 0 ? `${children} sub-page${children === 1 ? "" : "s"}` : relativeTime(note.modified)} />
          ))}
        </div>
      )}
      <MoreToggle total={parts.top.length} shown={8} open={all} onToggle={() => setAll((a) => !a)} />
    </DashCard>
  );
}

function Cards({ parts }: { parts: ProjectParts }) {
  const [all, setAll] = useState(false);
  const shown = all ? parts.cards : parts.cards.slice(0, 6);
  return (
    <DashCard title="Cards" icon="cards" count={parts.cards.length}>
      {parts.cards.length === 0 ? (
        <DashEmpty>Quick notes saved here become the project's cards.</DashEmpty>
      ) : (
        <div className="kasten-dash-rows">
          {shown.map((note) => (
            <NoteRow key={note.path} note={note} detail={note.excerpt ? note.excerpt.slice(0, 60) : undefined} />
          ))}
        </div>
      )}
      <MoreToggle total={parts.cards.length} shown={6} open={all} onToggle={() => setAll((a) => !a)} />
    </DashCard>
  );
}

/** The project's four newest decks, each with its first slide small; the + starts one here. */
function Decks({ parts, folder }: { parts: ProjectParts; folder: string }) {
  return (
    <DashCard
      title="Decks"
      icon="present"
      count={parts.decks.length}
      actions={
        <>
          {parts.decks.length > 0 && <SeeAll label="All decks" run={() => useWorkspace.getState().go({ view: "slides" })} />}
          <IconButton icon="plus" label="New deck in this project" size="sm" onClick={() => startNewDeck(folder)} />
        </>
      }
    >
      {parts.decks.length === 0 ? (
        <DashEmpty>No decks yet. The + makes one for this project, to present what it holds.</DashEmpty>
      ) : (
        <MiniList items={parts.decks} memory={`decks:${folder}`} row={(deck) => <DeckMini deck={deck} />} />
      )}
    </DashCard>
  );
}

/** The project's four newest whiteboards, a sketch and a line each; "Show all" for the rest, and a link to the Whiteboards view for this project. */
function Boards({ parts, folder, title }: { parts: ProjectParts; folder: string; title: string }) {
  return (
    <DashCard
      title="Whiteboards"
      icon="board"
      count={parts.boards.length}
      actions={
        <>
          {parts.boards.length > 0 && <SeeAll label="All whiteboards" run={() => showBoardsOf(folder)} />}
          <IconButton icon="plus" label="New whiteboard in this project" size="sm" onClick={() => void newBoard(folder, title)} />
        </>
      }
    >
      {parts.boards.length === 0 ? (
        <DashEmpty>No whiteboards yet. The + makes one for this project, to lay out its cards and ideas.</DashEmpty>
      ) : (
        <MiniList items={parts.boards} memory={`boards:${folder}`} row={(board) => <BoardMini board={board} />} />
      )}
    </DashCard>
  );
}
