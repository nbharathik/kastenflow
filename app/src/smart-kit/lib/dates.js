/* KastenFlow smart kit: date helpers. Dates are calendar dates ("2027-03-01"),
   counted on the calendar so a daylight-saving change never moves a day.
   Deadlines "anywhere on Earth" (AoE) end at 23:59:59 in UTC-12. Load after kit.js. */
(function (root) {
  "use strict";
  const kit = root.kit;
  const DAY = 86400000;
  const pad = (n) => (n < 10 ? "0" : "") + n;

  /** {y, m, d} for "YYYY-MM-DD" (a time after it is ignored) or a Date (local day); null when not a real date. */
  function ymd(v) {
    let y, m, d;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      y = v.getFullYear();
      m = v.getMonth() + 1;
      d = v.getDate();
    } else {
      const r = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(String(v));
      if (!r) return null;
      y = +r[1];
      m = +r[2];
      d = +r[3];
    }
    const check = new Date(Date.UTC(y, m - 1, d));
    return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d ? { y, m, d } : null;
  }
  const dayNumber = (p) => Math.round(Date.UTC(p.y, p.m - 1, p.d) / DAY);

  /** A Date at local midnight, or null. */
  function parseDate(v) {
    const p = ymd(v);
    return p ? new Date(p.y, p.m - 1, p.d) : null;
  }
  /** "YYYY-MM-DD" in the local calendar. */
  function isoDate(date) {
    const p = ymd(date);
    return p ? p.y + "-" + pad(p.m) + "-" + pad(p.d) : null;
  }
  /** The date `n` days after `iso`, as "YYYY-MM-DD". */
  function addDays(iso, n) {
    const p = ymd(iso);
    if (!p) return null;
    const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate());
  }
  /** Whole calendar days from `now` (local day) to `target`; negative when past; null when unreadable. */
  function daysUntil(target, now) {
    const a = ymd(now === undefined ? new Date() : now);
    const b = ymd(target);
    return a && b ? dayNumber(b) - dayNumber(a) : null;
  }
  /** The instant an AoE deadline ends: 23:59:59.999 in UTC-12 on `iso`. */
  function aoeInstant(iso) {
    const p = ymd(iso);
    return p ? new Date(Date.UTC(p.y, p.m - 1, p.d + 1, 11, 59, 59, 999)) : null;
  }
  /** Calendar days until an AoE deadline, counting today as the day it is in UTC-12 right now. */
  function daysUntilAoE(iso, now) {
    const t = (now === undefined ? new Date() : new Date(now)).getTime();
    const p = ymd(iso);
    if (!p || isNaN(t)) return null;
    const here = new Date(t - 12 * 3600000);
    return dayNumber(p) - Math.floor(here.getTime() / DAY);
  }
  /** Time left to an AoE deadline: { passed, ms, days, hours, minutes, seconds } (all positive, `passed` says which side). */
  function aoeRemaining(iso, now) {
    const end = aoeInstant(iso);
    const t = (now === undefined ? new Date() : new Date(now)).getTime();
    if (!end || isNaN(t)) return null;
    const diff = end.getTime() - t;
    const ms = Math.abs(diff);
    return {
      passed: diff < 0,
      ms,
      days: Math.floor(ms / DAY),
      hours: Math.floor((ms % DAY) / 3600000),
      minutes: Math.floor((ms % 3600000) / 60000),
      seconds: Math.floor((ms % 60000) / 1000),
    };
  }
  /** "today", "tomorrow", "in 5 days", "yesterday", "3 days ago". */
  function describeDays(n) {
    if (n === null || n === undefined) return "date unknown";
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    if (n === -1) return "yesterday";
    return n > 0 ? "in " + n + " days" : Math.abs(n) + " days ago";
  }
  /** A date for people: "Mar 3, 2027". Always the calendar date, whatever the time zone. */
  function formatDate(v, options) {
    const p = ymd(v);
    if (!p) return "";
    const o = Object.assign({ month: "short", day: "numeric", year: "numeric" }, options && options.format);
    return new Intl.DateTimeFormat((options && options.locale) || "en-US", Object.assign(o, { timeZone: "UTC" })).format(new Date(Date.UTC(p.y, p.m - 1, p.d)));
  }
  /**
   * Describe a date that may only be an estimate. Input: "2027-03-03", or
   * { date, announced?: false | status?: "est" | "announced", aoe?: true }.
   * A bare string counts as announced. Returns { iso, announced, aoe, days, label }
   * with label "est. Mar 3, 2027" for an estimate.
   */
  function dateInfo(input, options) {
    const o = input !== null && typeof input === "object" && !(input instanceof Date) ? input : { date: input };
    const iso = ymd(o.date) ? isoDate(parseDate(o.date)) : null;
    const status = String(o.status || "").toLowerCase();
    const announced = o.announced === false || status === "est" || status === "estimated" ? false : true;
    const aoe = o.aoe === true;
    const now = options && options.now;
    const days = iso === null ? null : aoe ? daysUntilAoE(iso, now) : daysUntil(iso, now);
    const text = iso ? formatDate(iso, options) : "";
    return { iso, announced, aoe, days, label: announced || !iso ? text : "est. " + text };
  }
  /** Sort comparator on "YYYY-MM-DD" strings; unreadable dates go last. */
  function compareDates(a, b) {
    const x = ymd(a);
    const y = ymd(b);
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    return dayNumber(x) - dayNumber(y);
  }
  /** Days in a month (month 1-12). */
  const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

  kit.dates = { parseDate, isoDate, addDays, daysUntil, aoeInstant, daysUntilAoE, aoeRemaining, describeDays, formatDate, dateInfo, compareDates, daysInMonth };
})(window);
