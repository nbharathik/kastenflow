// Settings → Pages → Smart pages: where smart pages stand (off until the
// plugin is turned on) and the way to the switch in Settings → Plugins, in the
// desktop app only.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePlugins } from "../../../../plugins/registry";
import { MemoryVault } from "../../preview/memory-vault";
import { useWorkspace } from "../../store";
import { entryById, searchSettings } from "./index";
import { GroupPage } from "./SettingsPage";

const group = (open: (id: string) => void = () => {}) => render(<GroupPage group="pages" flash={null} open={open} onSwitchVault={() => {}} />);

beforeEach(async () => {
  localStorage.clear();
  usePlugins.setState({ on: {} });
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  usePlugins.setState({ on: {} });
  delete (globalThis as unknown as { isTauri?: boolean }).isTauri;
});

describe("Smart pages in Settings", () => {
  it("is an entry of the index in the Pages group, found by what it does", () => {
    const entry = entryById("pages.smartRun")!;
    expect(entry.group).toBe("pages");
    expect(entry.label).toBe("Smart pages");
    expect(entry.only).toBe("desktop");
    expect(entry.help).toContain("off until you turn it on");
    expect(searchSettings("smart pages", true).ids.has("pages.smartRun")).toBe(true);
    expect(searchSettings("plugin", true).ids.has("pages.smartRun")).toBe(true);
    expect(searchSettings("smart pages", false).ids.has("pages.smartRun")).toBe(false);
  });

  it("is not drawn in the browser preview, where smart pages cannot run", async () => {
    group();
    await act(async () => {});
    expect(screen.queryByText("Open Plugins")).toBeNull();
  });

  it("says they are off in this vault until the plugin is turned on, and sends the person to Plugins", async () => {
    (globalThis as unknown as { isTauri: boolean }).isTauri = true;
    const open = vi.fn();
    group(open);
    expect(await screen.findByText("Off in this vault.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Plugins" }));
    expect(open).toHaveBeenCalledWith("plugins.list");
  });

  it("says they are on when the plugin is", async () => {
    (globalThis as unknown as { isTauri: boolean }).isTauri = true;
    usePlugins.setState({ on: { smart: true } });
    group();
    expect(await screen.findByText("On in this vault.")).toBeTruthy();
  });
});
