// The timeline view: notes along a scale of days
// in timeline/, placed by the view's start (and end) date property, or a word
// on how to get one when the tag has no date property. Loaded on first use.

import "../../pages/editor/styles/tokens.css";
import "./timeline/timeline.css";
import "./timeline/timeline-bars.css";

import { useMemo } from "react";

import { Icon } from "../../../ui/Icon";
import { keysOf } from "./timeline/items";
import { Timeline } from "./timeline/Timeline";
import type { ViewProps } from "./types";

export function TimelineView({ tag, schema, view, notes, onChange }: ViewProps) {
  const keys = useMemo(() => keysOf(view, schema), [view, schema]);
  if (!keys) return <NoDates tag={tag} />;
  return <Timeline tag={tag} schema={schema} view={view} notes={notes} keys={keys} onChange={onChange} />;
}

function NoDates({ tag }: { tag: string }) {
  return (
    <div className="kasten-tl-start" role="note">
      <span className="kasten-tl-start-icon" aria-hidden="true">
        <Icon name="calendar-days" className="size-6" />
      </span>
      <h2>Nothing to place on a timeline yet</h2>
      <p>
        A timeline lays #{tag}’s notes out along the calendar as bars. Add a date property with <strong>Properties</strong> at the top of this page, such as Start, and a second one such as Due
        for where the bars end. A note with only a start shows as a marker.
      </p>
    </div>
  );
}
