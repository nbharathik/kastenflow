// Small pure parts of a project's journal in the window: the timed line an
// entry is written as, and the link text for pasting a day into a page.

/** `- 14:30 Fixed the sort`: one entry, stamped with the local time. */
export function timedLine(text: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `- ${pad(now.getHours())}:${pad(now.getMinutes())} ${text.trim().replace(/\s*\r?\n\s*/g, " ")}`;
}

/** Where a project's day lives (`projects/<project>/journal/<year>/<date>`, no extension). */
export const dayStem = (folder: string, date: string): string => `projects/${folder}/journal/${date.slice(0, 4)}/${date}`;

/** A link to a project's day by path, as a page can hold it: `[[projects/p/journal/2026/2026-11-03|2026-11-03]]`. */
export const dayLink = (folder: string, date: string): string => `[[${dayStem(folder, date)}|${date}]]`;

/** The day a vault journal page's path names (`journal/2026/2026-11-03.md`); null for any other path. */
export const vaultDayOf = (path: string): string | null => /^journal\/\d{4}\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1] ?? null;
