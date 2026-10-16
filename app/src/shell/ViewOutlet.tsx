import { Suspense } from "react";

import { LazyBoard } from "../features/boards/canvas/LazyBoard";
import { LazyDeck } from "../features/slides/LazyDeck";
import { LazyNotePage } from "../features/workspace/page/LazyNotePage";
import { Home } from "../features/home/Home";
import { Inbox } from "../features/inbox/Inbox";
import { JournalView } from "../features/journal/JournalView";
import { howFromView, useWorkspace, type Place } from "../features/workspace/store";
import { BoardsHome, BrowserView, CalendarView, ChatView, CollectionsView, DiagramsHome, DiagramView, GraphView, HighlightsHome, History, ImportView, LibraryView, PdfReader, ProjectOverview, ProjectsHub, ReferencesView, Review, ReviewScreens, Settings, SlidesHome, TagDatabase, TagsHome, Tasks, Trash } from "./lazy-views";
import { ViewBoundary } from "../ui/ViewBoundary";

/** Renders a tab's place; views load their code when first opened. */
export function ViewOutlet({ place }: { place: Place }) {
  return (
    <ViewBoundary place={`${place.view}:${place.path ?? ""}`}>
      <Suspense fallback={null}>
        <View place={place} />
      </Suspense>
    </ViewBoundary>
  );
}

function View({ place }: { place: Place }) {
  const client = useWorkspace((s) => s.client);
  if (!client) return null;
  switch (place.view) {
    case "home":
      return <Home />;
    case "page":
      // Not keyed by path: a rename moves the open page, which keeps its
      // editor and caret; another page reloads inside it.
      return <LazyNotePage client={client} path={place.path!} />;
    case "inbox":
      // The path "triage" opens the Inbox in triage mode.
      return <Inbox triage={place.path === "triage"} />;
    case "journal":
      return <JournalView path={place.path} />;
    case "boards":
      return place.path ? <LazyBoard key={place.path} path={place.path} /> : <BoardsHome />;
    case "slides":
      return place.path ? <LazyDeck key={place.path} path={place.path} /> : <SlidesHome />;
    case "diagrams":
      // Not keyed by path: after a conflict the editor goes on with a copy, and the tab follows it without reloading.
      return place.path ? <DiagramView path={place.path} /> : <DiagramsHome />;
    case "library":
      // Ctrl+click opens a card in a tab, Shift+click on the side stack.
      return <LibraryView onOpen={(path, event) => useWorkspace.getState().openPath(path, howFromView(event))} />;
    case "tasks":
      return <Tasks />;
    case "calendar":
      return <CalendarView />;
    case "highlights":
      return place.path ? <PdfReader key={place.path} path={place.path} /> : <HighlightsHome />;
    case "tags":
      return place.path ? <TagDatabase key={place.path} tag={place.path.replace(/^#/, "")} /> : <TagsHome />;
    case "chat":
      return <ChatView />;
    case "trash":
      return <Trash />;
    case "settings":
      return <Settings />;
    case "import":
      return <ImportView />;
    case "review":
      return <Review />;
    case "history":
      return <History />;
    case "graph":
      // Around the page it was opened from, when it names one.
      return <GraphView key={place.path ?? ""} path={place.path} />;
    case "overview":
      return place.path ? <ProjectOverview key={place.path} path={place.path} /> : <Home />;
    case "projects":
      return <ProjectsHub />;
    case "web":
      // Not keyed by address: the page moves the tab's address as it goes, and keeps its view.
      return <BrowserView place={place} />;
    case "collections":
      // Not keyed by file: a rename moves the open collection, and the list keeps its place.
      return <CollectionsView path={place.path} />;
    case "references":
      return <ReferencesView />;
    case "reviews":
      // The path is the kind of review: "daily" (the default) or "weekly".
      return <ReviewScreens path={place.path} />;
    default:
      return <Home />;
  }
}
