// The calendar's mentions in the browser preview, as the core's index finds
// them (index/query.rs, day_mentions): notes that link a day outside a
// to-do and outside the day's own page, by day, then newest first.

import type { DayMention, NoteMeta } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { isRealDay, timeAfter } from "./day-times";

const DAY_LINK = /!?\[\[(\d{4}-\d{2}-\d{2})(?:[#|][^\]]*)?\]\]/g;
const TASK = /^\s*[-*+]\s+\[[ xX]\]\s/;

export function dayMentionsIn(notes: readonly NoteMeta[], text: (path: string) => string, from: string, to: string): DayMention[] {
  const out: DayMention[] = [];
  for (const note of [...notes].sort((a, b) => b.modified - a.modified)) {
    if (note.kind === "template") continue;
    const seen = new Set<string>();
    for (const line of splitFrontmatter(text(note.path)).body.split(/\r?\n/)) {
      if (TASK.test(line)) continue;
      for (const link of line.matchAll(DAY_LINK)) {
        const day = link[1];
        if (!day || day < from || day > to || day === note.title || seen.has(day)) continue;
        seen.add(day);
        // The time directly after the link, for a day that exists.
        const at = isRealDay(day) ? timeAfter(line.slice((link.index ?? 0) + link[0].length)) : null;
        out.push({ day, path: note.path, title: note.title, icon: note.icon, kind: note.kind, snippet: line.trim().slice(0, 200), at });
      }
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}
