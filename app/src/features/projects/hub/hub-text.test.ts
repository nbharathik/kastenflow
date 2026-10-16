import { describe, expect, it } from "vitest";

import { activityText, agoShort, contentsText } from "./hub-text";
import { DAY, HOUR, NOW, summary } from "./test-support";

const date = (ms: number, year = false) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) }).format(new Date(ms));

describe("how long ago", () => {
  it("is short and gets coarser", () => {
    expect(agoShort(NOW - 20_000, NOW)).toBe("just now");
    expect(agoShort(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(agoShort(NOW - 2 * HOUR, NOW)).toBe("2 h ago");
    expect(agoShort(NOW - 30 * HOUR, NOW)).toBe("yesterday");
    expect(agoShort(NOW - 3 * DAY, NOW)).toBe("3 days ago");
  });

  it("gives the date after a week, with the year once it is another year", () => {
    expect(agoShort(NOW - 10 * DAY, NOW)).toBe(date(NOW - 10 * DAY));
    expect(agoShort(NOW - 400 * DAY, NOW)).toBe(date(NOW - 400 * DAY, true));
  });

  it("does not go negative for a clock that is a little behind", () => {
    expect(agoShort(NOW + 5 * 60_000, NOW)).toBe("just now");
  });
});

describe("the line about the latest activity", () => {
  it("says when and what", () => {
    expect(activityText({ modified: NOW - 2 * HOUR, path: "p", title: "Pitch deck", kind: "deck" }, NOW)).toBe("edited 2 h ago · Pitch deck");
  });

  it("leaves out a title that is empty, and says when there is nothing", () => {
    expect(activityText({ modified: NOW - 2 * HOUR, path: "p", title: "", kind: "page" }, NOW)).toBe("edited 2 h ago");
    expect(activityText(null, NOW)).toBe("No activity yet");
  });
});

describe("what a project holds", () => {
  it("counts pages, whiteboards and decks, in words, leaving out what is none", () => {
    expect(contentsText(summary("a", { notes: 12, boards: 2, decks: 1 }))).toBe("12 pages · 2 boards · 1 deck");
    expect(contentsText(summary("b", { notes: 1, boards: 0, decks: 3 }))).toBe("1 page · 3 decks");
    expect(contentsText(summary("c"))).toBe("Nothing in it yet");
  });
});
