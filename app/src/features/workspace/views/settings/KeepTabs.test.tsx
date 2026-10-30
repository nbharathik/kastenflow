// Settings → Pages: "Keep recent tabs ready" is 0 (off) to 8, four to begin with, and kept.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePrefs } from "../../prefs";
import { PageSettings } from "./PageSettings";

beforeEach(() => {
  localStorage.clear();
  usePrefs.getState().set({ keepTabs: 4 });
});
afterEach(cleanup);

const select = () => screen.getByRole("combobox", { name: "Keep recent tabs ready" }) as HTMLSelectElement;

describe("Keep recent tabs ready", () => {
  it("offers Off and 1 to 8, with 4 to begin with", () => {
    render(<PageSettings />);
    expect([...select().options].map((o) => o.textContent)).toEqual(["Off", "1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(select().value).toBe("4");
  });

  it("is kept", async () => {
    render(<PageSettings />);
    await act(async () => fireEvent.change(select(), { target: { value: "0" } }));
    expect(usePrefs.getState().keepTabs).toBe(0);
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).keepTabs).toBe(0);
    await act(async () => fireEvent.change(select(), { target: { value: "8" } }));
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).keepTabs).toBe(8);
  });

  it("is clamped to 0 to 8 whatever is set", () => {
    usePrefs.getState().set({ keepTabs: 50 });
    expect(usePrefs.getState().keepTabs).toBe(8);
    usePrefs.getState().set({ keepTabs: -2 });
    expect(usePrefs.getState().keepTabs).toBe(0);
  });
});
