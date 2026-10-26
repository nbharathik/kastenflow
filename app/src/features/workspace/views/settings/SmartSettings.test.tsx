// Settings → Pages → Smart pages: "Run smart pages", on until a person turns
// it off, in the desktop app only.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tauriSmartBackend } from "../../../smart/backend";
import { forgetRunSwitch } from "../../../smart/run-switch";
import { MemoryVault } from "../../preview/memory-vault";
import { useWorkspace } from "../../store";
import { entryById, searchSettings } from "./index";
import { GroupPage } from "./SettingsPage";

const group = () => render(<GroupPage group="pages" flash={null} open={() => {}} onSwitchVault={() => {}} />);

beforeEach(async () => {
  localStorage.clear();
  forgetRunSwitch();
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (globalThis as unknown as { isTauri?: boolean }).isTauri;
});

describe("Run smart pages", () => {
  it("is an entry of the index in the Pages group, found by what it does", () => {
    const entry = entryById("pages.smartRun")!;
    expect(entry.group).toBe("pages");
    expect(entry.label).toBe("Run smart pages");
    expect(entry.only).toBe("desktop");
    expect(searchSettings("smart pages", true).ids.has("pages.smartRun")).toBe(true);
    expect(searchSettings("kill switch", true).ids.has("pages.smartRun")).toBe(true);
    expect(searchSettings("smart pages", false).ids.has("pages.smartRun")).toBe(false);
  });

  it("is not drawn in the browser preview, where smart pages cannot run", async () => {
    group();
    await act(async () => {});
    expect(screen.queryByRole("switch", { name: "Run smart pages" })).toBeNull();
  });

  it("is on by default, turns every page off with one click and back on with another", async () => {
    (globalThis as unknown as { isTauri: boolean }).isTauri = true;
    vi.spyOn(tauriSmartBackend, "runEnabled").mockResolvedValue(true);
    const set = vi.spyOn(tauriSmartBackend, "setRunEnabled").mockResolvedValue();
    group();
    const toggle = (await screen.findByRole("switch", { name: "Run smart pages" })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    toggle.click();
    await waitFor(() => expect(set).toHaveBeenLastCalledWith(false));
    await waitFor(() => expect((screen.getByRole("switch", { name: "Run smart pages" }) as HTMLInputElement).checked).toBe(false));
    (screen.getByRole("switch", { name: "Run smart pages" }) as HTMLInputElement).click();
    await waitFor(() => expect(set).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect((screen.getByRole("switch", { name: "Run smart pages" }) as HTMLInputElement).checked).toBe(true));
  });

  it("shows what the app says when it was turned off before", async () => {
    (globalThis as unknown as { isTauri: boolean }).isTauri = true;
    vi.spyOn(tauriSmartBackend, "runEnabled").mockResolvedValue(false);
    group();
    await waitFor(() => expect((screen.getByRole("switch", { name: "Run smart pages" }) as HTMLInputElement).checked).toBe(false));
  });

  it("stays as it was, and says so, when the app could not keep the choice", async () => {
    (globalThis as unknown as { isTauri: boolean }).isTauri = true;
    vi.spyOn(tauriSmartBackend, "runEnabled").mockResolvedValue(true);
    vi.spyOn(tauriSmartBackend, "setRunEnabled").mockRejectedValue(new Error("no place"));
    group();
    (await screen.findByRole("switch", { name: "Run smart pages" })).click();
    await waitFor(() => expect(useWorkspace.getState().toasts.map((t) => t.text).join(" ")).toContain("could not be turned off"));
    expect((screen.getByRole("switch", { name: "Run smart pages" }) as HTMLInputElement).checked).toBe(true);
  });
});
