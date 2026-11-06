// Settings → Agents → Coding agents in the chat: what was found on this
// computer with its version, the commands for what is missing, and "Test".

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../chat/agents/client", () => ({
  listAgents: vi.fn(),
  testAgent: vi.fn(),
  answerApproval: vi.fn(),
}));

import { listAgents, testAgent } from "../../../chat/agents/client";
import type { AgentInfo } from "../../../chat/agents/types";
import { CodingAgents } from "./CodingAgents";
import { Group } from "./parts";

const CODE: AgentInfo = {
  id: "claude-code",
  label: "Claude Code",
  provider: "Claude Code (CLI)",
  found: true,
  path: "C:\\Users\\a\\.local\\bin\\claude.exe",
  version: "2.1.211 (Claude Code)",
  install: "Install Claude Code with npm install -g @anthropic-ai/claude-code.",
  signIn: "Sign in once in a terminal: run claude.",
};
const OPEN: AgentInfo = { id: "opencode", label: "OpenCode", provider: "OpenCode (CLI)", found: false, path: null, version: null, install: "Install OpenCode with npm install -g opencode-ai.", signIn: "Sign in with opencode auth login." };

const show = async () => {
  render(
    <Group title="Coding agents in the chat" sub>
      <CodingAgents />
    </Group>,
  );
  await act(async () => {});
};

beforeEach(() => {
  vi.mocked(listAgents).mockResolvedValue([CODE, OPEN]);
  vi.mocked(testAgent).mockReset();
});
afterEach(cleanup);

describe("Coding agents in Settings", () => {
  it("lists what was found with its version and where, and the commands for what is missing", async () => {
    await show();
    const code = document.querySelector('[data-agent="claude-code"]') as HTMLElement;
    expect(within(code).getByText("Claude Code")).toBeTruthy();
    expect(within(code).getByText(/2\.1\.211 \(Claude Code\) · C:\\Users\\a\\\.local\\bin\\claude\.exe/)).toBeTruthy();
    const open = document.querySelector('[data-agent="opencode"]') as HTMLElement;
    expect(within(open).getByText("Not found on this computer")).toBeTruthy();
    // How to install and sign in, said where the person looks; nothing is installed from here.
    expect(within(open).getByRole("note").textContent).toContain("npm install -g opencode-ai");
    expect(within(open).getByRole("note").textContent).toContain("opencode auth login");
    expect((within(open).getByRole("button", { name: "Test OpenCode" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("tests the program itself and shows what it said", async () => {
    vi.mocked(testAgent).mockResolvedValue({ ok: true, version: "2.1.211", signedIn: true, message: "Claude Code 2.1.211 is installed and signed in." });
    await show();
    const button = screen.getByRole("button", { name: "Test Claude Code" });
    // Reachable and pressed from the keyboard.
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => fireEvent.click(button));
    expect(testAgent).toHaveBeenCalledWith("claude-code");
    expect((await screen.findByRole("status")).textContent).toBe("Claude Code 2.1.211 is installed and signed in.");
  });

  it("says when the program is not signed in, with what to run", async () => {
    vi.mocked(testAgent).mockResolvedValue({ ok: false, version: "2.1.211", signedIn: false, message: "Claude Code 2.1.211 is installed but not signed in. Sign in once in a terminal: run claude." });
    await show();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test Claude Code" })));
    expect((await screen.findByRole("status")).getAttribute("data-ok")).toBe("false");
    expect(screen.getByRole("status").textContent).toContain("not signed in");
  });

  it("shows a program that could not be tested as an error line, not a silent button", async () => {
    vi.mocked(testAgent).mockRejectedValue(new Error("It did not answer in time"));
    await show();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test Claude Code" })));
    expect((await screen.findByRole("status")).textContent).toBe("It did not answer in time");
  });

  it("says so when the look failed, and while it looks", async () => {
    vi.mocked(listAgents).mockRejectedValue(new Error("The look failed"));
    await show();
    expect(await screen.findByText("The agents could not be looked for")).toBeTruthy();
    expect(screen.getByText("The look failed")).toBeTruthy();
  });
});
