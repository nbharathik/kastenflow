// Under a capture's title: where it came from and when, as it was written
// when it was caught (triage changes neither), and its reading state, which
// is its own: independent of the project it is filed in or any task made
// from it.

import { stampDay } from "../../lib/dates";
import { openUrl } from "../../lib/api";
import type { NoteMeta } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { capturedDay } from "./DuplicateNotice";
import { READING_STATES, readingOf } from "./queue";
import { setReading } from "./triage-actions";

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** The address's host, for a line that has no site name. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SourceLine({ card }: { card: NoteMeta }) {
  const url = text(card.props.url);
  // Only a web address is a link: a note edited by hand may say anything.
  const web = url !== null && /^https?:\/\//i.test(url) ? url : null;
  const day = capturedDay(card);
  const site = text(card.props.site) ?? (web ? hostOf(web) : null);
  const reading = readingOf(card);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-muted">
      {day && <span>{site ? `Captured ${stampDay(day)} from ${site}` : `Caught ${stampDay(day)}`}</span>}
      {web && (
        <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" title={web} onClick={() => void openUrl(web)}>
          <Icon name="external" className="size-3.5" />
          Open the page
        </button>
      )}
      <span role="group" aria-label="Reading state" className="ml-auto inline-flex items-center gap-1">
        {READING_STATES.map((state) => (
          <button
            key={state}
            type="button"
            aria-pressed={reading === state}
            title={reading === state ? `Marked ${state}: press to clear` : `Mark ${state}`}
            onClick={() => void setReading(card, reading === state ? null : state)}
            className={`rounded-md px-2 py-0.5 text-12 ring-1 ring-line transition-colors ${reading === state ? "bg-soft font-medium text-ink" : "hover:bg-hover"}`}
          >
            {state}
          </button>
        ))}
      </span>
    </div>
  );
}
