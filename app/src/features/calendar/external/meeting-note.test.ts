import { describe, expect, it } from "vitest";

import { meetingDraft } from "./meeting-note";
import type { ExternalEvent } from "./types";

const event = (over: Partial<ExternalEvent> = {}): ExternalEvent => ({
  calendar: "cal",
  id: "e1",
  uid: "u1",
  title: "Team standup",
  allDay: false,
  start: "2026-10-12T09:00",
  end: "2026-10-12T09:30",
  location: null,
  description: null,
  link: "https://meet.example.com/abc",
  tentative: false,
  zoneGuess: false,
  ...over,
});

describe("a meeting note for an event", () => {
  it("is titled and dated as the event is, with its link among the properties", () => {
    expect(meetingDraft(event(), true)).toEqual({
      kind: "page",
      title: "Team standup",
      // The time too, so the template's time is the event's.
      date: "2026-10-12T09:00",
      template: "meeting",
      tags: undefined,
      props: { date: "2026-10-12", url: "https://meet.example.com/abc" },
    });
  });

  it("is dated by the day for an all-day event, and has no link property without a link", () => {
    const draft = meetingDraft(event({ allDay: true, start: "2026-10-20", end: "2026-10-22", link: null }), true);
    expect(draft.date).toBe("2026-10-20");
    expect(draft.props).toEqual({ date: "2026-10-20" });
  });

  it("is a plain page tagged meeting when the vault has no meeting template", () => {
    const draft = meetingDraft(event(), false);
    expect(draft.template).toBeNull();
    expect(draft.tags).toEqual(["meeting"]);
  });

  it("has a title even when the event has none", () => {
    expect(meetingDraft(event({ title: "  " }), true).title).toBe("Meeting");
  });
});
