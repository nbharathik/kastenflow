// The data of a review screen: what the window already holds (the note list),
// the to-dos the index found and the projects' summaries. Everything here is a
// read; the reads are the ones Home and the Projects hub already make.

import { useEffect, useMemo, useRef } from "react";

import { dayFrom } from "../../lib/dates";
import { useTaskList } from "../dashboard/task-rows";
import { useSummaries } from "../projects/hub/use-summaries";
import { useWorkspace } from "../workspace/store";
import { assembleReview, periodOf, type Review, type ReviewKind, type ReviewPeriod } from "./assemble";

export interface ReviewData {
  review: Review;
  period: ReviewPeriod;
  /** The to-dos or the projects are still being read. */
  loading: boolean;
}

export function useReview(kind: ReviewKind): ReviewData {
  const notes = useWorkspace((s) => s.notes);
  const tasks = useTaskList();
  const { list: projects, reload } = useSummaries();
  const today = dayFrom(0);
  const period = useMemo(() => periodOf(kind, today), [kind, today]);
  const review = useMemo(() => assembleReview({ period, notes, tasks, projects }), [period, notes, tasks, projects]);

  // A project marked reviewed changes its page: read the summaries again at once, as the revision counters do a moment later.
  const pages = notes
    .filter((n) => n.kind === "project")
    .map((n) => `${n.path}:${n.modified}`)
    .join("|");
  const seen = useRef(pages);
  useEffect(() => {
    if (seen.current === pages) return;
    seen.current = pages;
    reload();
  }, [pages, reload]);

  return { review, period, loading: tasks === null || projects === null };
}
