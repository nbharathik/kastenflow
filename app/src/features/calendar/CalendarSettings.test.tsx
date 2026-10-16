// Settings → Calendar → Reviews: the weekly review's reminder, off until
// switched on, and the day it first shows.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { currentReview, DEFAULT_REVIEW, useReviewPrefs } from "../review-screens/review-prefs";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { CalendarSettings } from "./CalendarSettings";

beforeEach(async () => {
  localStorage.clear();
  useReviewPrefs.setState({ saved: {} });
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
});
afterEach(cleanup);

const reviews = () => screen.getByRole("region", { name: "Reviews" });

describe("the weekly review's reminder in Settings", () => {
  it("is off until it is switched on, with Friday as its day", () => {
    render(<CalendarSettings />);
    const reminder = within(reviews()).getByRole("switch", { name: "Weekly review reminder" }) as HTMLInputElement;
    expect(reminder.checked).toBe(false);
    expect(currentReview()).toMatchObject({ remind: false, weekday: DEFAULT_REVIEW.weekday });
    expect(within(reviews()).getByRole("radio", { name: "Fri" }).getAttribute("aria-checked")).toBe("true");
  });

  it("switches on and takes another day, for this vault, and the choice is the one the review screen shows", () => {
    render(<CalendarSettings />);
    fireEvent.click(within(reviews()).getByRole("switch", { name: "Weekly review reminder" }));
    fireEvent.click(within(reviews()).getByRole("radio", { name: "Mon" }));
    expect(currentReview()).toMatchObject({ remind: true, weekday: 1 });
    expect(JSON.parse(localStorage.getItem("kasten.reviews")!)["Browser preview"]).toMatchObject({ remind: true, weekday: 1 });
    // The day went from Friday to Monday: the way back to the usual shows.
    expect(within(reviews()).getByRole("button", { name: "Reset Reminder day" })).toBeTruthy();
  });

  it("puts a snoozed banner back in play when it is switched on again", () => {
    useReviewPrefs.getState().set("Browser preview", { remind: false, snoozed: "2026-10-11" });
    render(<CalendarSettings />);
    fireEvent.click(within(reviews()).getByRole("switch", { name: "Weekly review reminder" }));
    expect(currentReview().snoozed).toBeNull();
  });
});
