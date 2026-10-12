// Settings → Pages: the text size is one of four, kept for every page that
// does not set its own.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePrefs } from "../../prefs";
import { PageSettings } from "./PageSettings";

beforeEach(() => {
  localStorage.clear();
  usePrefs.getState().set({ textSize: "normal" });
});
afterEach(cleanup);

describe("Text size", () => {
  const group = () => screen.getByRole("radiogroup", { name: "Text size" });
  const chosen = () => within(group()).getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent);

  it("offers four sizes, with Normal chosen to begin with", () => {
    render(<PageSettings />);
    expect(within(group()).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Small", "Normal", "Large", "Extra large"]);
    expect(chosen()).toEqual(["Normal"]);
  });

  it("is kept, for each of the sizes", async () => {
    render(<PageSettings />);
    for (const [label, size] of [["Large", "large"], ["Extra large", "xl"], ["Small", "small"], ["Normal", "normal"]] as const) {
      await act(async () => fireEvent.click(within(group()).getByRole("radio", { name: label })));
      expect(usePrefs.getState().textSize).toBe(size);
      expect(JSON.parse(localStorage.getItem("kasten.prefs")!).textSize).toBe(size);
      expect(chosen()).toEqual([label]);
    }
  });

  it("shows the size that was kept", () => {
    usePrefs.getState().set({ textSize: "xl" });
    render(<PageSettings />);
    expect(chosen()).toEqual(["Extra large"]);
  });

  it("no longer has the Small text switch", () => {
    render(<PageSettings />);
    expect(screen.queryByRole("switch", { name: "Small text" })).toBeNull();
  });
});
