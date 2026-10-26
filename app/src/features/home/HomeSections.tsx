// The sections of Home, by id. A section with nothing to show renders nothing
// and its cell folds away (home.css). The ones that are heavy, or turned on by
// few, load when Home asks for them: Today (the calendar's code) and the
// whiteboard, deck, week and journal cards.

import { lazy, Suspense } from "react";

import { DashCard } from "../dashboard/DashCard";
import { CardBoundary } from "./CardBoundary";
import { Favourites } from "./Favourites";
import { PageDirectory } from "./PageDirectory";
import { ProjectTiles } from "./ProjectTiles";
import { RecentList } from "./RecentList";
import { Inbox, Todos } from "./SideCards";
import { HOME_SECTIONS, type HomeSection } from "./sections";

const Schedule = lazy(() => import("./Schedule").then((m) => ({ default: m.Schedule })));
const ExtraCard = lazy(() => import("./ExtraCards").then((m) => ({ default: m.ExtraCard })));
const AgentsToday = lazy(() => import("./AgentsToday").then((m) => ({ default: m.AgentsToday })));
/** Apart from the others: their pictures bring the Slides package with them. */
const ThumbCard = lazy(() => import("./ThumbCards").then((m) => ({ default: m.ThumbCard })));

/** Today's place while its code loads: the same card, so nothing moves when it arrives. */
function TodayPlace() {
  return (
    <DashCard title="Today" icon="calendar">
      <div className="kasten-todo-skeleton" aria-hidden="true">
        <span className="kasten-todo-bone" />
        <span className="kasten-todo-bone" />
      </div>
    </DashCard>
  );
}

/** `withToday`: Today is on, so the to-dos leave out what is due today. */
export function HomeSectionView({ id, withToday = false }: { id: HomeSection; withToday?: boolean }) {
  switch (id) {
    case "favourites":
      return <Favourites />;
    case "projects":
      return <ProjectTiles />;
    case "recent":
      return <RecentList />;
    case "pages":
      return <PageDirectory />;
    case "schedule":
      return (
        <CardBoundary name="Today">
          <Suspense fallback={<TodayPlace />}>
            <Schedule />
          </Suspense>
        </CardBoundary>
      );
    case "todo":
      return <Todos withToday={withToday} />;
    case "inbox":
      return <Inbox />;
    case "week":
    case "journal":
      return (
        <CardBoundary name={HOME_SECTIONS.find((d) => d.id === id)!.label}>
          <Suspense fallback={null}>
            <ExtraCard id={id} />
          </Suspense>
        </CardBoundary>
      );
    case "agents":
      return (
        <CardBoundary name="Agents today">
          <Suspense fallback={null}>
            <AgentsToday />
          </Suspense>
        </CardBoundary>
      );
    case "boards":
    case "decks":
      return (
        <CardBoundary name={HOME_SECTIONS.find((d) => d.id === id)!.label}>
          <Suspense fallback={null}>
            <ThumbCard id={id} />
          </Suspense>
        </CardBoundary>
      );
  }
}
