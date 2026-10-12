// Settings → Appearance: Motion is kept and the window follows it at once;
// the interface size is kept for the display and scales the window.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { chooseZoom } from "../../../../lib/zoom";
import { usePrefs } from "../../prefs";
import { AppearanceSettings } from "./AppearanceSettings";

afterEach(async () => {
  cleanup();
  usePrefs.getState().set({ motion: "system" });
  delete document.documentElement.dataset.motion;
  await chooseZoom("auto");
  localStorage.clear();
});

describe("Motion", () => {
  it("is kept, and switches the window's motion off and on", async () => {
    render(<AppearanceSettings />);
    const motion = screen.getByRole("radiogroup", { name: "Motion" });
    expect(within(motion).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");

    await act(async () => fireEvent.click(within(motion).getByRole("radio", { name: "Off" })));
    expect(document.documentElement.dataset.motion).toBe("off");
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).motion).toBe("off");
    expect(within(motion).getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("true");

    await act(async () => fireEvent.click(within(motion).getByRole("radio", { name: "On" })));
    expect(document.documentElement.dataset.motion).toBe("on");
  });
});

describe("Interface size", () => {
  const zoomStyle = () => document.documentElement.style.getPropertyValue("zoom");
  const kept = () => JSON.parse(localStorage.getItem("kasten.zoom.byDisplay") ?? "{}") as Record<string, unknown>;
  const chosen = (group: HTMLElement) => within(group).getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent);

  it("offers Auto and five sizes, starting on Auto", () => {
    render(<AppearanceSettings />);
    const size = screen.getByRole("radiogroup", { name: "Interface size" });
    expect(within(size).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Auto", "90%", "100%", "110%", "125%", "150%"]);
    expect(chosen(size)).toEqual(["Auto"]);
    expect(screen.getByRole("status", { name: "Current interface size" }).textContent).toBe("100%");
  });

  it("is kept for the display and scales the window, by a pick or by the buttons", async () => {
    render(<AppearanceSettings />);
    const size = screen.getByRole("radiogroup", { name: "Interface size" });
    const now = () => screen.getByRole("status", { name: "Current interface size" }).textContent;

    await act(async () => fireEvent.click(within(size).getByRole("radio", { name: "110%" })));
    await waitFor(() => expect(now()).toBe("110%"));
    expect(chosen(size)).toEqual(["110%"]);
    expect(zoomStyle()).toBe("1.1");
    expect(kept()).toEqual({ browser: 1.1 });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Zoom in" })));
    await waitFor(() => expect(now()).toBe("125%"));
    expect(chosen(size)).toEqual(["125%"]);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Zoom out" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Zoom out" })));
    await waitFor(() => expect(now()).toBe("100%"));
    expect(chosen(size)).toEqual(["100%"]);
    expect(zoomStyle()).toBe("");

    await act(async () => fireEvent.click(within(size).getByRole("radio", { name: "Auto" })));
    await waitFor(() => expect(chosen(size)).toEqual(["Auto"]));
    expect(kept()).toEqual({ browser: "auto" });
  });

  it("shows a level only the keys reach with none picked, and stops the buttons at the ends", async () => {
    render(<AppearanceSettings />);
    const size = screen.getByRole("radiogroup", { name: "Interface size" });
    await act(async () => void (await chooseZoom(0.67)));
    await waitFor(() => expect(screen.getByRole("status", { name: "Current interface size" }).textContent).toBe("67%"));
    expect(chosen(size)).toEqual([]);
    expect(screen.getByRole("button", { name: "Zoom out" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Zoom in" }).hasAttribute("disabled")).toBe(false);
  });
});
