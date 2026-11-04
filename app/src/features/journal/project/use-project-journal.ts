// What the project journal peek shows and does: the project's days (paged),
// the text of the day being looked at, and adding an entry. Every write is the
// core's `journalAppend`, one commit per entry.

import { useCallback, useEffect, useRef, useState } from "react";

import { said } from "../../../lib/said";
import type { NoteFile, ProjectJournalDay, VaultClient } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { useWorkspace } from "../../workspace/store";
import { timedLine } from "./entry";

/** Days asked for at a time. */
export const PAGE = 30;

const bodyOf = (note: NoteFile): string => splitFrontmatter(note.text).body.trim();

export function useProjectJournal(client: VaultClient, folder: string, today: string) {
  const [days, setDays] = useState<ProjectJournalDay[]>([]);
  const [total, setTotal] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const [listed, setListed] = useState(false);
  const [viewing, setViewing] = useState(today);
  /** The viewed day's text; null while it is read. */
  const [text, setText] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const asked = useRef(0);
  const adding = useRef(false);
  const dayPath = days.find((d) => d.date === viewing)?.path ?? null;

  const load = useCallback(
    (count: number) =>
      client
        .projectJournalDays(folder, count, 0)
        .then((page) => {
          setDays(page.days);
          setTotal(page.total);
          setTitle(page.projectTitle);
          setListed(true);
        })
        .catch(said("Could not open the journal")),
    [client, folder],
  );

  useEffect(() => {
    void load(PAGE);
  }, [load]);

  // The viewed day's text, once the list says whether it has any.
  useEffect(() => {
    if (!listed) return;
    const turn = ++asked.current;
    if (!dayPath) {
      setText("");
      return;
    }
    client
      .read(dayPath)
      .then((note) => turn === asked.current && setText(bodyOf(note)))
      .catch((err: unknown) => {
        if (turn === asked.current) setText("");
        said("Could not read that day")(err);
      });
  }, [client, dayPath, listed]);

  const showMore = useCallback(() => {
    setMore(true);
    client
      .projectJournalDays(folder, PAGE, days.length)
      .then((page) => {
        setDays((have) => [...have, ...page.days.filter((d) => !have.some((h) => h.date === d.date))]);
        setTotal(page.total);
      })
      .catch(said("Could not load more days"))
      .finally(() => setMore(false));
  }, [client, folder, days.length]);

  /** Adds `entry` to today as a timed line. True when it was added. */
  const add = useCallback(
    async (entry: string): Promise<boolean> => {
      if (!entry.trim() || adding.current) return false;
      adding.current = true;
      try {
        const note = await client.journalAppend(today, timedLine(entry), null, folder);
        asked.current++;
        setText(bodyOf(note));
        useWorkspace.getState().noteChanged(note.meta);
        await load(Math.max(PAGE, days.length));
        return true;
      } catch (err) {
        said("Could not add the entry")(err);
        return false;
      } finally {
        adding.current = false;
      }
    },
    [client, folder, today, load, days.length],
  );

  /** The viewed day's note, made if nobody has written in it yet. */
  const pathOfViewed = useCallback(async (): Promise<string | null> => {
    if (dayPath) return dayPath;
    try {
      const note = await client.journal(viewing, folder);
      useWorkspace.getState().noteChanged(note.meta);
      return note.meta.path;
    } catch (err) {
      said("Could not open the day")(err);
      return null;
    }
  }, [client, folder, viewing, dayPath]);

  /** Looks at another day: its text is read again. */
  const view = useCallback(
    (date: string) => {
      if (date === viewing) return;
      setText(null);
      setViewing(date);
    },
    [viewing],
  );

  return { days, total, title, listed, viewing, view, text, more, showMore, add, pathOfViewed };
}
