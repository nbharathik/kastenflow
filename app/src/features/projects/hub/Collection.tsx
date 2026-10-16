// The projects themselves: cards in a gallery, or rows in a compact list. The
// gallery draws every card and leaves the off-screen ones to the browser
// (`content-visibility`); the list draws only the rows in view, so a vault of
// hundreds of projects stays smooth. One tab stop and the arrow keys serve both.

import { useMemo } from "react";

import type { ProjectSummary } from "../../../lib/vault/project-types";
import type { CardActions } from "./CardParts";
import type { HubLayout } from "./hub-model";
import { columnsFor } from "./hub-keys";
import { HubRow, ROW_HEIGHT } from "./HubRow";
import { ProjectCard } from "./ProjectCard";
import { useCardNav, type NavActions } from "./use-card-nav";
import { useWindow } from "./use-window";

interface Props {
  shown: readonly ProjectSummary[];
  layout: HubLayout;
  /** When the summaries were read. */
  now: number;
  /** Project folders that are pinned. */
  pinned: ReadonlySet<string>;
  cardActions: CardActions;
  navActions: NavActions;
}

export function Collection({ shown, layout, now, pinned, cardActions, navActions }: Props) {
  const list = layout === "list";
  const order = useMemo(() => shown.map((s) => s.folder), [shown]);
  const win = useWindow(shown.length, ROW_HEIGHT, list);
  const nav = useCardNav({
    order,
    columns: () => {
      const el = win.list.current;
      return list || !el ? 1 : columnsFor(getComputedStyle(el).gridTemplateColumns, el.clientWidth);
    },
    rows: list ? 10 : 2,
    reveal: list ? win.reveal : undefined,
    actions: navActions,
  });
  const drawn = list ? shown.slice(win.range.start, win.range.end) : shown;
  // The tab stop is on a card that is drawn: the list may have scrolled away from the one it was on.
  const tabAt = drawn.some((s) => s.folder === nav.active) ? nav.active : (drawn[0]?.folder ?? null);
  const attach = (el: HTMLUListElement | null) => {
    win.list.current = el;
    nav.root.current = el;
  };
  return (
    <ul
      ref={attach}
      role="list"
      aria-label={list ? "Project list" : "Project gallery"}
      className={list ? "kasten-hub-list" : "kasten-hub-grid"}
      style={list ? { paddingTop: win.before, paddingBottom: win.after } : undefined}
      {...nav.rootProps}
    >
      {drawn.map((s) => {
        const props = { s, now, pinned: pinned.has(s.folder), tab: s.folder === tabAt, actions: cardActions };
        return list ? <HubRow key={s.path} {...props} /> : <ProjectCard key={s.path} {...props} />;
      })}
    </ul>
  );
}

/** Holding places while the first answer comes, so the page does not jump when it arrives. */
export function Skeleton() {
  return (
    <ul className="kasten-hub-grid" aria-busy="true" aria-label="Loading the projects">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="kasten-hub-card is-skeleton" aria-hidden="true">
          <span className="kasten-hub-bone is-title" />
          <span className="kasten-hub-bone is-line" />
          <span className="kasten-hub-bone is-line" />
          <span className="kasten-hub-bone is-bar" />
        </li>
      ))}
    </ul>
  );
}
