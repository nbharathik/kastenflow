import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../lib/vault/types";
import { CAPTURE_TAG as OVERVIEW_TAG } from "../projects/overview/items";
import { CAPTURE_TAG, caughtThisWeek, deferredFrom, deferredUntil, inQueue, isDeferred, isFiled, laterDay, nextReading, queueOf, readingOf } from "./queue";

const TODAY = "2026-10-11";

const note = (path: string, over: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: null,
  title: path,
  kind: "card",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: Date.parse("2026-10-11T09:00:00"),
  created: "2026-10-11T09:00:00",
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...over,
});

const capture = (path: string, over: Partial<NoteMeta> = {}) => note(path, { tags: ["capture"], ...over });

describe("the capture queue", () => {
  it("means the tag the overview's Captures tab means", () => {
    expect(CAPTURE_TAG).toBe(OVERVIEW_TAG);
  });

  it("is the Inbox plus the captures nobody has filed, newest first", () => {
    const notes = [
      note("inbox/old.md", { created: "2026-10-01T09:00:00" }),
      note("inbox/new.md", { created: "2026-10-10T09:00:00" }),
      capture("library/saved-page.md", { created: "2026-10-05T09:00:00" }),
      // Filed in a project already, a page, a template and a note that is not a capture: not waiting.
      capture("projects/trip/cards/in-project.md", { project: "trip" }),
      capture("library/a-page.md", { kind: "page" }),
      capture("templates/capture.md", { kind: "template" }),
      note("library/plain.md"),
    ];
    expect(queueOf(notes, TODAY).map((n) => n.path)).toEqual(["inbox/new.md", "library/saved-page.md", "inbox/old.md"]);
  });

  it("counts a capture in the Inbox once", () => {
    const notes = [capture("inbox/clip.md")];
    expect(queueOf(notes, TODAY)).toHaveLength(1);
  });

  it("leaves out what is filed, and what is put off until a later day", () => {
    const notes = [
      capture("library/filed.md", { props: { status: "Filed" } }),
      capture("library/read.md", { props: { status: "Read" } }),
      note("inbox/later.md", { props: { review_after: "2026-10-12" } }),
      note("inbox/today.md", { props: { review_after: TODAY } }),
      note("inbox/past.md", { props: { review_after: "2026-10-01" } }),
    ];
    // "Read" is not "filed"; a day put off to comes back on that day.
    expect(queueOf(notes, TODAY).map((n) => n.path).sort()).toEqual(["inbox/past.md", "inbox/today.md", "library/read.md"]);
    expect(deferredFrom(notes, TODAY).map((n) => n.path)).toEqual(["inbox/later.md"]);
  });

  it("brings a put-off card back when its day comes", () => {
    const later = note("inbox/later.md", { props: { review_after: "2026-10-12" } });
    expect(inQueue(later, TODAY)).toBe(false);
    expect(inQueue(later, "2026-10-12")).toBe(true);
  });

  it("reads the day it was put off to only when it is a real day", () => {
    expect(deferredUntil(note("a.md", { props: { review_after: "2026-10-12" } }))).toBe("2026-10-12");
    expect(deferredUntil(note("a.md", { props: { review_after: "2026-02-31" } }))).toBeNull();
    expect(deferredUntil(note("a.md", { props: { review_after: "soon" } }))).toBeNull();
    expect(deferredUntil(note("a.md", { props: { review_after: 5 } }))).toBeNull();
    expect(deferredUntil(note("a.md"))).toBeNull();
    expect(isDeferred(note("a.md", { props: { review_after: "garbage" } }), TODAY)).toBe(false);
  });

  it("calls a capture filed only when it is one", () => {
    expect(isFiled(capture("a.md", { props: { status: "filed" } }))).toBe(true);
    expect(isFiled(note("a.md", { props: { status: "Filed" } }))).toBe(false);
  });
});

describe("the days a card can be put off to", () => {
  it("are tomorrow, a week on and a month on, in the person's own days", () => {
    expect(laterDay("tomorrow", TODAY)).toBe("2026-10-12");
    expect(laterDay("week", TODAY)).toBe("2026-10-18");
    expect(laterDay("month", TODAY)).toBe("2026-11-11");
  });

  it("keeps a month's end inside the next month", () => {
    expect(laterDay("month", "2026-01-31")).toBe("2026-02-28");
    expect(laterDay("month", "2028-01-31")).toBe("2028-02-29");
    expect(laterDay("month", "2026-12-15")).toBe("2027-01-15");
    expect(laterDay("tomorrow", "2026-12-31")).toBe("2027-01-01");
  });
});

describe("reading", () => {
  it("is Unread, Reading or Finished, whatever the case, or nothing", () => {
    expect(readingOf(note("a.md", { props: { reading: "Reading" } }))).toBe("Reading");
    expect(readingOf(note("a.md", { props: { reading: "finished" } }))).toBe("Finished");
    expect(readingOf(note("a.md", { props: { reading: "half" } }))).toBeNull();
    expect(readingOf(note("a.md"))).toBeNull();
  });

  it("steps from nothing through the three and back to nothing", () => {
    expect(nextReading(null)).toBe("Unread");
    expect(nextReading("Unread")).toBe("Reading");
    expect(nextReading("Reading")).toBe("Finished");
    expect(nextReading("Finished")).toBeNull();
  });
});

describe("the captures of this week", () => {
  it("are the ones caught in the last seven days, in the person's own days", () => {
    const cards = [
      note("a.md", { created: "2026-10-11T00:30:00" }),
      note("b.md", { created: "2026-10-04T23:30:00" }),
      note("c.md", { created: "2026-10-03T23:30:00" }),
      note("d.md", { created: "2026-09-01T10:00:00" }),
    ];
    // The collections' "last 7 days" is the seven days before today and today.
    expect(caughtThisWeek(cards, TODAY).map((n) => n.path)).toEqual(["a.md", "b.md"]);
  });
});
