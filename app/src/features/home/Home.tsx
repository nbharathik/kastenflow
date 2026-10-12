// Home: the start page, short enough to take in at a glance. One line at the
// top (the greeting, a field to capture a thought, "+ New"), a list of what you
// were on with filters, and a slim column beside it for today, the to-dos and
// the Inbox. Everything else is in Customize, off until asked for. A blank
// vault offers a first page and the tour.

import "../dashboard/dashboard.css";
import "./home.css";

import { Button } from "../../ui/Button";
import { useBoards } from "../boards/store";
import { useDiagrams } from "../diagrams/store";
import { useDecks } from "../slides/store";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { HomeBar } from "./HomeBar";
import { HomeSectionView } from "./HomeSections";
import { homeSections, inZone, type HomeSection } from "./sections";

export function Home() {
  const saved = usePrefs((s) => s.homeSections);
  const sections = homeSections(saved);
  const ready = useWorkspace((s) => s.ready);
  // A new vault has only its templates: offer a first page, or the tour.
  const blank = useWorkspace((s) => s.notes.every((n) => n.kind === "template"));
  const others = useBoards((s) => s.list.length) + useDecks((s) => s.list.length) + useDiagrams((s) => s.list.length);
  const welcome = ready && blank && others === 0;
  const main = inZone(sections, "main");
  const side = inZone(sections, "side");
  const withToday = sections.includes("schedule");
  const cell = (id: HomeSection) => (
    <div key={id} className="kasten-home-cell" data-section={id}>
      <HomeSectionView id={id} withToday={withToday} />
    </div>
  );
  return (
    <div className="kasten-home">
      <div className="kasten-home-page">
        <HomeBar sections={sections} />
        <div className="kasten-home-body">
          <div className="kasten-home-main">{welcome ? <Welcome /> : main.map(cell)}</div>
          {side.length > 0 && <aside className="kasten-home-side">{side.map(cell)}</aside>}
        </div>
      </div>
    </div>
  );
}

function Welcome() {
  const { newPage, takeTour } = useWorkspace.getState();
  return (
    <section className="kasten-home-welcome" aria-label="Getting started">
      <p className="text-16 font-semibold">A blank vault, ready for you</p>
      <p className="mt-1.5 max-w-sm text-13 text-muted">Write a first page or catch a quick note above. The tour shows what else KastenFlow can do, in a page of its own.</p>
      <div className="mt-4 flex gap-2">
        <Button tone="primary" icon="compose" onClick={() => newPage()}>
          New page
        </Button>
        <Button icon="help" onClick={() => void takeTour()}>
          Take the tour
        </Button>
      </div>
    </section>
  );
}
