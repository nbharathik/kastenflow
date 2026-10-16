// The palette's "Triage captures", "Daily review", "Weekly review" and
// "Subscribe to a calendar…", and their places in the shortcut lists.

import { beforeEach, describe, expect, it } from "vitest";

import { KEY_SECTIONS } from "../../shortcuts/catalog";
import { useWorkspace } from "../store";
import { derive } from "../store-layout";
import { initialLayout } from "../tabs";
import { useSettingsJump } from "../views/settings/jump";
import { COMMANDS } from "./commands";

beforeEach(() => {
  useSettingsJump.setState({ target: null });
  useWorkspace.setState({ ...derive(initialLayout()), notes: [], stack: [], stackOpen: false });
});

const command = (id: string) => COMMANDS.find((c) => c.id === id)!;

describe("the palette's review and capture commands", () => {
  it("Triage captures opens the Inbox in triage mode", () => {
    expect(command("triage").label).toBe("Triage captures");
    command("triage").run();
    expect(useWorkspace.getState().place).toEqual({ view: "inbox", path: "triage" });
  });

  it("Daily review and Weekly review open the review screen at their kind", () => {
    command("review-daily").run();
    expect(useWorkspace.getState().place).toEqual({ view: "reviews", path: "daily" });
    command("review-weekly").run();
    expect(useWorkspace.getState().place).toEqual({ view: "reviews", path: "weekly" });
  });

  it("Subscribe to a calendar opens Settings at the Calendar group's subscribe row", () => {
    expect(command("calendar-subscribe").label).toBe("Subscribe to a calendar…");
    command("calendar-subscribe").run();
    expect(useWorkspace.getState().place.view).toBe("settings");
    expect(useSettingsJump.getState().target).toMatchObject({ group: "calendar", row: "calendar.subscribe" });
  });

  it("are found by the words a person would try, and are in the shortcut sheet once", () => {
    expect(command("triage").words).toContain("defer");
    expect(command("review-weekly").words).toContain("reminder");
    expect(command("calendar-subscribe").words).toContain("webcal");
    const listed = KEY_SECTIONS.flatMap((s) => s.ids);
    for (const id of ["triage", "review-daily", "review-weekly", "calendar-subscribe"]) {
      expect(listed.filter((l) => l === id)).toHaveLength(1);
      expect(COMMANDS.filter((c) => c.id === id)).toHaveLength(1);
    }
  });
});
