// A project's journal as a quick look on the right (the side peek's frame,
// shell/peek): today's entry, a line to add a timed entry, and the earlier
// days. Loaded when the journal button is first pressed.

import "../../../shell/peek/peek.css";
import "./project-journal.css";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import { dayFrom, longDay } from "../../../lib/dates";
import { copyOrSay } from "../../../lib/said";
import type { NoteMeta, VaultClient } from "../../../lib/vault/types";
import { IconButton } from "../../../ui/Button";
import { Icon } from "../../../ui/Icon";
import { boxOf } from "../../browser/bounds";
import { useOccludes } from "../../browser/occlusion";
import { Markdown } from "../../chat/markdown/Markdown";
import { usePeek } from "../../peek/store";
import { useWorkspace, type OpenHow } from "../../workspace/store";
import { dayLink } from "./entry";
import { useProjectJournal } from "./use-project-journal";

interface Props {
  client: VaultClient;
  /** The project's page. */
  project: NoteMeta;
  onClose(): void;
}

const openTitle = (title: string, how: OpenHow) => void useWorkspace.getState().openTitle(title, how);

export function ProjectJournalPeek({ client, project, onClose }: Props) {
  const folder = project.project ?? "";
  const [today] = useState(() => dayFrom());
  const journal = useProjectJournal(client, folder, today);
  const { viewing, days, total } = journal;
  const name = journal.title ?? project.title;
  const input = useRef<HTMLInputElement>(null);
  const [entry, setEntry] = useState("");
  const earlier = days.filter((d) => d.date !== today);

  // A web page's native window would sit over the peek.
  useOccludes(true, () => {
    const side = document.querySelector(".kasten-journal-peek");
    return side ? boxOf(side.getBoundingClientRect()) : null;
  });

  // Over another peek there would be two: this one takes the place.
  useEffect(() => {
    usePeek.getState().close();
    input.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    // A press in the views behind closes it, as the page peek does.
    const onDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.("[data-peek-closes]")) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void journal.add(entry).then((added) => {
      if (added) setEntry("");
      input.current?.focus();
    });
  };

  const openAsPage = async () => {
    const path = await journal.pathOfViewed();
    if (!path) return;
    onClose();
    useWorkspace.getState().openPath(path);
  };

  const copyLink = async () => {
    if (await copyOrSay(dayLink(folder, viewing), "the link")) useWorkspace.getState().toast("Link copied");
  };

  return createPortal(
    <aside className="kasten-peek-side kasten-journal-peek" role="dialog" aria-label="Project journal">
      <header className="kasten-peek-head">
        <IconButton icon="expand" label="Open as page" size="sm" onClick={() => void openAsPage()} />
        <IconButton icon="link" label="Copy link" size="sm" onClick={() => void copyLink()} />
        <span className="kasten-peek-title">
          <Icon name="journal" className="mr-1 inline size-[15px] align-text-bottom" /> {name} · {viewing === today ? "Today" : longDay(viewing)}
        </span>
        <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
      </header>
      <div className="kasten-journal-peek-body">
        <p className="kasten-journal-peek-date">{longDay(viewing)}</p>
        {viewing !== today && (
          <button type="button" className="ui-btn is-quiet is-sm" onClick={() => journal.view(today)}>
            Back to today
          </button>
        )}
        <div className="kasten-journal-peek-entry" aria-live="polite">
          {journal.text === null ? null : journal.text ? <Markdown text={journal.text} onOpenTitle={openTitle} /> : <p className="kasten-journal-peek-empty">{viewing === today ? "Nothing written today yet." : "Nothing written on this day."}</p>}
        </div>
        {viewing === today && (
          <form className="kasten-journal-peek-add" onSubmit={submit}>
            <input ref={input} value={entry} onChange={(event) => setEntry(event.target.value)} aria-label="Add an entry" placeholder="Add an entry, then Enter" autoComplete="off" spellCheck />
          </form>
        )}
        <section aria-label="Earlier days" className="kasten-journal-peek-days">
          <h3>Earlier days</h3>
          {journal.listed && earlier.length === 0 && <p className="kasten-journal-peek-empty">No earlier days.</p>}
          <ul>
            {earlier.map((day) => (
              <li key={day.date}>
                <button type="button" aria-current={day.date === viewing ? "true" : undefined} onClick={() => journal.view(day.date)}>
                  <span className="kasten-journal-peek-day">{day.date}</span>
                  <span className="kasten-journal-peek-excerpt">{day.excerpt}</span>
                </button>
              </li>
            ))}
          </ul>
          {days.length < total && (
            <button type="button" className="ui-btn is-quiet is-sm" disabled={journal.more} onClick={journal.showMore}>
              Show more
            </button>
          )}
        </section>
      </div>
    </aside>,
    document.body,
  );
}
