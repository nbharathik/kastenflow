// Settings → Home: a switch for each section of the Home page, kept as the
// same choice Customize on Home makes.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HOME_DEFAULT, HOME_SECTIONS, homeSections } from "../../../home/sections";
import { usePrefs } from "../../prefs";
import { HomeSettings, ResetHome } from "./HomeSettings";

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ homeSections: null });
});
afterEach(cleanup);

const toggle = (label: string) => screen.getByRole("switch", { name: label }) as HTMLInputElement;

describe("Settings → Home", () => {
  it("has a switch for every section, on for the ones Home starts with", () => {
    render(<HomeSettings />);
    expect(screen.getAllByRole("switch")).toHaveLength(HOME_SECTIONS.length);
    for (const section of HOME_SECTIONS) expect(toggle(section.label).checked, section.label).toBe(HOME_DEFAULT.includes(section.id));
  });

  it("takes a section off Home and puts it back, as the usual choice once it is as it was", () => {
    render(<HomeSettings />);
    const first = HOME_SECTIONS.find((s) => HOME_DEFAULT.includes(s.id))!;
    fireEvent.click(toggle(first.label));
    expect(toggle(first.label).checked).toBe(false);
    expect(homeSections(usePrefs.getState().homeSections)).not.toContain(first.id);
    // The dot and the way back show for a setting that is not the usual.
    fireEvent.click(screen.getByRole("button", { name: `Reset ${first.label}` }));
    expect(toggle(first.label).checked).toBe(true);
    expect(usePrefs.getState().homeSections).toBeNull();
  });

  it("turns on one Home does not start with, and the header's button goes back to the usual", () => {
    render(
      <>
        <HomeSettings />
        <ResetHome />
      </>,
    );
    const reset = screen.getByRole("button", { name: "Back to the usual" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    const extra = HOME_SECTIONS.find((s) => !HOME_DEFAULT.includes(s.id));
    if (!extra) return;
    fireEvent.click(toggle(extra.label));
    expect(homeSections(usePrefs.getState().homeSections)).toContain(extra.id);
    expect(reset.disabled).toBe(false);
    act(() => reset.click());
    expect(usePrefs.getState().homeSections).toBeNull();
    expect(toggle(extra.label).checked).toBe(false);
  });
});
