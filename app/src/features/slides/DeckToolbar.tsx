import { Segmented } from "../../ui/Segmented";
import { type DeckSort } from "./deck-sort";
import { type DeckView, HOME_SORTS, VIEWS } from "./home-prefs";

const ICONS = { grid: "layout", list: "list" } as const;

export interface ProjectChoice {
  key: string;
  title: string;
}

/** Over the decks: how many, the project they are in, the order, and grid or list. The project box is there only when some deck is in one. */
export function DeckToolbar({
  count,
  sort,
  onSort,
  view,
  onView,
  projects,
  project,
  onProject,
}: {
  count: number;
  sort: DeckSort;
  onSort(sort: DeckSort): void;
  view: DeckView;
  onView(view: DeckView): void;
  projects: readonly ProjectChoice[];
  project: string | null;
  onProject(project: string | null): void;
}) {
  return (
    <div className="mt-9 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h2 className="flex items-center gap-2 text-12 font-medium text-muted">
        All decks
        <span className="rounded bg-well px-1.5 text-11 font-medium text-muted">{count}</span>
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {projects.length > 0 && (
          <select
            aria-label="Show decks of"
            value={project ?? "*"}
            onChange={(e) => onProject(e.target.value === "*" ? null : e.target.value)}
            className="h-8 max-w-[200px] rounded-lg border border-line bg-canvas px-2 text-13 outline-none focus:border-accent/60"
          >
            <option value="*">All projects</option>
            <option value="">Not in a project</option>
            {projects.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.title}
              </option>
            ))}
          </select>
        )}
        <Segmented<DeckSort> label="Sort decks by" value={sort} choices={HOME_SORTS} onChange={onSort} />
        <Segmented<DeckView> label="Show decks as" value={view} choices={VIEWS.map((choice) => ({ ...choice, icon: ICONS[choice.value] }))} iconsOnly onChange={onView} />
      </div>
    </div>
  );
}
