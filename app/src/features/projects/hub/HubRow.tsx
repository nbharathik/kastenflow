// A project as one row of the compact list: the same facts as the card, in
// columns. Rows are one fixed height so a long list can be windowed.

import { memo } from "react";

import { Icon } from "../../../ui/Icon";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";
import { iconOf } from "../../workspace/names";
import { Counts, Marks, MoreButton, NextAction, Progress } from "./CardParts";
import { activityText } from "./hub-text";
import { hitProps, itemProps, type ItemProps } from "./ProjectCard";

/** The height of a row in pixels; hub.css gives rows the same. */
export const ROW_HEIGHT = 56;

export const HubRow = memo(function HubRow({ s, now, pinned, tab, actions }: ItemProps) {
  return (
    <li className="kasten-hub-row" data-status={s.status} data-pinned={pinned || undefined} data-archived={s.archived || undefined} {...itemProps(s, actions)}>
      <button type="button" className="kasten-hub-hit" {...hitProps(s, tab)} />
      <div className="kasten-hub-row-body">
        <span className="kasten-hub-icon">
          <IconOrEmoji icon={iconOf({ icon: s.icon, kind: "project" })} />
        </span>
        <span className="kasten-hub-row-name">
          <span className="kasten-hub-row-title">
            <h2 className="kasten-hub-title" title={s.title}>
              {s.title}
            </h2>
            {pinned && (
              <span role="img" aria-label="Pinned" title="Pinned" className="kasten-hub-pin">
                <Icon name="pin" className="size-3.5 rotate-45" />
              </span>
            )}
          </span>
          {s.summary && <span className="kasten-hub-row-summary">{s.summary}</span>}
        </span>
        <Marks s={s} />
        <span className="kasten-hub-row-todos">
          <Counts s={s} />
          <Progress s={s} />
        </span>
        <span className="kasten-hub-row-next">
          <NextAction s={s} tab={tab} />
        </span>
        <span className="kasten-hub-row-when">{activityText(s.latest, now)}</span>
        <MoreButton s={s} tab={tab} actions={actions} />
      </div>
    </li>
  );
});
