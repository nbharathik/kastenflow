// A project as a card in the gallery. A button under the text (so the keyboard
// and screen readers have something to land on) opens the overview, and so does
// a click anywhere on the card that is not a button of its own; the next
// action, "Project page" and "…" sit over it. Only the card that has the list's
// tab stop puts its buttons in the tab order: the arrow keys move between
// cards, so Tab does not have to walk through every one.

import { memo, type MouseEvent } from "react";

import type { ProjectSummary } from "../../../lib/vault/project-types";
import { Icon } from "../../../ui/Icon";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";
import { iconOf } from "../../workspace/names";
import { howFrom } from "../../workspace/store";
import { Counts, Marks, MoreButton, NextAction, openFrom, Progress, type CardActions } from "./CardParts";
import { openOverviewOf, openPageOf } from "./hub-actions";
import { activityText, contentsText } from "./hub-text";

export interface ItemProps {
  s: ProjectSummary;
  /** When the summaries were read, for "2 h ago". */
  now: number;
  pinned: boolean;
  /** This item has the list's tab stop. */
  tab: boolean;
  actions: CardActions;
}

/** The invisible button under a card or row. */
export function hitProps(s: ProjectSummary, tab: boolean) {
  return {
    "data-card": s.folder,
    tabIndex: tab ? 0 : -1,
    "aria-label": `Open ${s.title}`,
    title: "Open the overview",
    onClick: (event: MouseEvent) => openFrom(s, event),
  };
}

/** What a click, a middle click and a right-click on the card or row (not on a button in it) do. */
export function itemProps(s: ProjectSummary, actions: CardActions) {
  const onButton = (event: MouseEvent) => (event.target as HTMLElement).closest("button") !== null;
  return {
    onClick: (event: MouseEvent) => {
      if (!onButton(event)) openFrom(s, event);
    },
    onAuxClick: (event: MouseEvent) => {
      if (event.button !== 1 || onButton(event)) return;
      event.preventDefault();
      openOverviewOf(s, "tab");
    },
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      actions.menu(s, { x: event.clientX, y: event.clientY }, null);
    },
  };
}

export const ProjectCard = memo(function ProjectCard({ s, now, pinned, tab, actions }: ItemProps) {
  return (
    <li className="kasten-hub-card" data-status={s.status} data-pinned={pinned || undefined} data-archived={s.archived || undefined} {...itemProps(s, actions)}>
      <button type="button" className="kasten-hub-hit" {...hitProps(s, tab)} />
      <div className="kasten-hub-card-body">
        <div className="kasten-hub-head">
          <span className="kasten-hub-icon">
            <IconOrEmoji icon={iconOf({ icon: s.icon, kind: "project" })} />
          </span>
          <h2 className="kasten-hub-title" title={s.title}>
            {s.title}
          </h2>
          {pinned && (
            <span role="img" aria-label="Pinned" title="Pinned" className="kasten-hub-pin">
              <Icon name="pin" className="size-3.5 rotate-45" />
            </span>
          )}
          <MoreButton s={s} tab={tab} actions={actions} />
        </div>
        <Marks s={s} />
        {s.summary && <p className="kasten-hub-summary">{s.summary}</p>}
        <div className="kasten-hub-figures">
          <Progress s={s} />
          <Counts s={s} />
        </div>
        <NextAction s={s} tab={tab} />
        <div className="kasten-hub-foot">
          <span className="kasten-hub-meta">
            <span>{activityText(s.latest, now)}</span>
            <span>{contentsText(s)}</span>
          </span>
          <button type="button" className="ui-btn is-quiet is-sm kasten-hub-page-link" tabIndex={tab ? 0 : -1} aria-label={`Project page of ${s.title}`} onClick={(event: MouseEvent) => openPageOf(s, howFrom(event))}>
            Project page
          </button>
        </div>
      </div>
    </li>
  );
});
