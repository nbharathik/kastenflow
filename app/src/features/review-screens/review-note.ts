// "Save as note": a review written out as an ordinary page, only when asked.
// The page holds links to the notes the review lists and plain bullets, never
// a to-do line or a day mark, so saving a review makes no new to-do and moves
// nothing on the calendar.

import { shortDay } from "../../lib/dates";
import type { NoteFile, NoteMeta } from "../../lib/vault/types";
import { linkFor } from "../workspace/links";
import { useWorkspace } from "../workspace/store";
import { noteAt } from "../workspace/tree";
import { CAPTURES_SHOWN, periodWords, type DueItem, type Review, type ReviewPeriod } from "./assemble";
import { markDone } from "./review-prefs";

const KIND_WORD = { daily: "Daily", weekly: "Weekly" } as const;

/** The page's title: the kind and the last day, with a number when the name is taken. */
export function reviewTitle(period: ReviewPeriod, notes: readonly Pick<NoteMeta, "title">[]): string {
  const base = `${KIND_WORD[period.kind]} review ${period.to}`;
  const taken = new Set(notes.map((n) => n.title.toLowerCase()));
  for (let n = 1; ; n++) {
    const title = n === 1 ? base : `${base} (${n})`;
    if (!taken.has(title.toLowerCase())) return title;
  }
}

function dueLine(item: DueItem, notes: readonly NoteMeta[]): string {
  const page = noteAt(notes, item.path);
  const where = page ? linkFor(page, notes) : item.where;
  return item.kind === "task" ? `- ${where}, due ${shortDay(item.due)}` : `- ${item.text}, due ${shortDay(item.due)}, in ${where}`;
}

const links = (list: readonly NoteMeta[], notes: readonly NoteMeta[]) => list.map((n) => `- ${linkFor(n, notes)}`);

/** The review as Markdown. Sections with nothing in them are left out. */
export function reviewMarkdown(review: Review, period: ReviewPeriod, notes: readonly NoteMeta[], { highlights }: { highlights: boolean }): string {
  const parts: string[] = [`${KIND_WORD[period.kind]} review for ${periodWords(period)}.`];
  const section = (title: string, count: number, lines: string[]) => {
    if (count > 0) parts.push(`## ${title} (${count})\n\n${lines.join("\n")}`);
  };
  const more = review.captures.count - review.captures.items.length;
  section("Captures to triage", review.captures.count, [...links(review.captures.items, notes), ...(more > 0 ? [`- and ${more} more (the first ${CAPTURES_SHOWN} are listed)`] : [])]);
  section("Overdue", review.overdue.length, review.overdue.map((i) => dueLine(i, notes)));
  section("Due", review.due.length, review.due.map((i) => dueLine(i, notes)));
  section(
    "Projects due for review",
    review.projects.length,
    review.projects.map((p) => {
      const page = noteAt(notes, p.path);
      return `- ${page ? linkFor(page, notes) : p.title}${p.reviewAfter ? `, review was due ${shortDay(p.reviewAfter)}` : ""}`;
    }),
  );
  section("Decisions", review.decisions.length, links(review.decisions, notes));
  section("Completed", review.completed.length, links(review.completed, notes));
  if (highlights) section("Highlights to revisit", review.highlights.length, links(review.highlights, notes));
  if (parts.length === 1) parts.push("Nothing needed attention.");
  return `${parts.join("\n\n")}\n`;
}

/** Makes the page, opens it and marks the review done today; null when the page could not be made (the window has said why). Undo moves the page to the trash and puts the mark back. */
export async function saveReviewAsNote(review: Review, period: ReviewPeriod, highlights: boolean): Promise<NoteFile | null> {
  const workspace = useWorkspace.getState();
  const body = reviewMarkdown(review, period, workspace.notes, { highlights });
  const note = await workspace.create({ kind: "page", title: reviewTitle(period, workspace.notes), tags: ["review"], props: { review: period.kind, date: period.to }, body }, true);
  if (!note) return null;
  const before = markDone(period.kind, period.today);
  useWorkspace.getState().toast(`Saved the ${period.kind} review as a note`, {
    label: "Undo",
    run: () => {
      void useWorkspace.getState().trash(note.meta.path, true);
      markDone(period.kind, before);
    },
  });
  return note;
}
