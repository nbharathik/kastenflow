// Settings → AI agents: what to copy to connect one, the installed app's
// own command first, and the HTTP token copied without ever being shown.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../../preview/memory-vault";
import { useWorkspace } from "../../store";
import { AgentSettings } from "./AgentSettings";
import { urlConfig } from "./connect";

const writeText = vi.fn(async (_text: string) => {});

beforeEach(async () => {
  localStorage.clear();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
});
afterEach(cleanup);

describe("Settings → AI agents", () => {
  it("offers Claude Code, MCP apps and clients that connect by URL", async () => {
    render(<AgentSettings />);
    const section = await screen.findByRole("region", { name: "AI agents" });
    await act(async () => fireEvent.click(within(section).getByTitle(/^Copy: claude mcp add --scope user kasten -- /)));
    expect(writeText).toHaveBeenLastCalledWith('claude mcp add --scope user kasten -- kasten-mcp --vault "~/Notes"');

    // How to connect by URL is behind the row's ?.
    expect(section.textContent).not.toContain("with the token as a bearer");
    fireEvent.click(within(section).getByRole("button", { name: "About Clients that connect by URL" }));
    expect(section.textContent).toContain("connect to http://127.0.0.1:7433/mcp with the token as a bearer");
    expect(section.textContent).toContain("~/Notes/.kasten/cache/mcp-token");
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Copy the URL config" })));
    expect(writeText).toHaveBeenLastCalledWith(urlConfig());
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Copy the command" })));
    expect(writeText).toHaveBeenLastCalledWith('kasten-mcp --vault "~/Notes" --http');
  });

  it("says the browser preview has no token rather than copying one", async () => {
    render(<AgentSettings />);
    const section = await screen.findByRole("region", { name: "AI agents" });
    writeText.mockClear();
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Copy the token" })));
    expect(writeText).not.toHaveBeenCalled();
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("The browser preview serves no MCP, so it has no token");
  });
});
