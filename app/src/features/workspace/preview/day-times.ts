// The core's dates.rs in the browser preview: days that exist on the
// calendar, and the 24-hour time that directly follows a day link or an
// `@date` (`[[2026-10-07]] 09:00`, `@2026-10-07 9:05`).

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `YYYY-MM-DD` naming a day that exists (leap years counted). */
export function isRealDay(s: string): boolean {
  const found = DAY.exec(s);
  if (!found) return false;
  const [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

const TIME = /^[ \t]+(\d{1,2}):(\d{2})(?![\p{Alphabetic}\p{N}:])/u;

/** The `HH:MM` time that follows `rest` after at least one space or tab. `9:05pm`, `09:00:30` and `25:00` are no times. */
export function timeAfter(rest: string): string | null {
  const found = TIME.exec(rest);
  if (!found) return null;
  const [hour, minute] = [Number(found[1]), Number(found[2])];
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${found[2]}`;
}

/** The first day a to-do names and its time: a `[[day]]` link first, then `@day`, then `📅 day` (which has no time). */
export function dueAt(text: string): { day: string; at: string | null } | null {
  for (const link of text.matchAll(/\[\[([^[]*?)\]\]/g)) {
    const start = link.index ?? 0;
    if (start > 0 && text[start - 1] === "\\") continue;
    const target = (link[1] ?? "").split("|")[0]!.split("#")[0]!.trim();
    if (isRealDay(target)) return { day: target, at: timeAfter(text.slice(start + link[0].length)) };
  }
  for (let from = text.indexOf("@"); from >= 0; from = text.indexOf("@", from + 1)) {
    const day = text.slice(from + 1, from + 11);
    if (isRealDay(day)) return { day, at: timeAfter(text.slice(from + 11)) };
  }
  for (const marker of ["📅 ", "📅"]) {
    for (let from = text.indexOf(marker); from >= 0; from = text.indexOf(marker, from + 1)) {
      const day = text.slice(from + marker.length, from + marker.length + 10);
      if (isRealDay(day)) return { day, at: null };
    }
  }
  return null;
}
