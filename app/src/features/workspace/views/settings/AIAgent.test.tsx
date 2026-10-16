// Settings → AI providers: the assistant's limits for one go, and the
// connection report of the last requests.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RequestOutcome } from "../../../chat/agent-types";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../../../chat/test-kit";
import { useWorkspace } from "../../store";
import { AgentLimits } from "./AgentLimits";
import { ConnectionReport } from "./ConnectionReport";

let chat: Scripted;
const toast = vi.fn();

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  useWorkspace.setState({ toast });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const field = (name: string) => screen.getByRole("spinbutton", { name }) as HTMLInputElement;
const loaded = async (name: string) => {
  await waitFor(() => expect(field(name).disabled).toBe(false));
  return field(name);
};
const typeInto = (input: HTMLInputElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("Agent limits", () => {
  it("shows what the backend has, in steps, tool calls and minutes", async () => {
    chat.budgetValues = { rounds: 120, calls: 400, minutes: 45 };
    render(<AgentLimits />);
    expect((await loaded("Steps in one go")).value).toBe("120");
    expect(field("Tool calls in one go").value).toBe("400");
    expect(field("Minutes in one go").value).toBe("45");
    expect(screen.getByText("steps")).toBeTruthy();
    expect(screen.getByText("tool calls")).toBeTruthy();
    expect(screen.getByText("minutes")).toBeTruthy();
  });

  it("saves a new limit, held to the bounds the backend takes", async () => {
    render(<AgentLimits />);
    typeInto(await loaded("Steps in one go"), "2500");
    await waitFor(() => expect(chat.budgetValues.rounds).toBe(1000));
    expect(toast).toHaveBeenCalledWith("Saved the new limit");
    typeInto(field("Minutes in one go"), "0");
    await waitFor(() => expect(chat.budgetValues.minutes).toBe(1));
    typeInto(field("Tool calls in one go"), "12.6");
    await waitFor(() => expect(chat.budgetValues.calls).toBe(13));
    expect(chat.budgetValues).toEqual({ rounds: 1000, calls: 13, minutes: 1 });
  });

  it("changes nothing for an empty box or the same value", async () => {
    const asked = vi.spyOn(chat, "setBudgets");
    render(<AgentLimits />);
    typeInto(await loaded("Steps in one go"), "");
    typeInto(field("Steps in one go"), "80");
    await act(async () => {});
    expect(asked).not.toHaveBeenCalled();
  });

  it("marks a limit that is not the usual one, and goes back to it", async () => {
    chat.budgetValues = { rounds: 200, calls: 250, minutes: 30 };
    render(<AgentLimits />);
    await loaded("Steps in one go");
    expect(screen.getAllByRole("img", { name: "Changed from the usual" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Reset Steps in one go" }));
    await waitFor(() => expect(chat.budgetValues.rounds).toBe(80));
    await waitFor(() => expect(field("Steps in one go").value).toBe("80"));
    expect(screen.queryByRole("img", { name: "Changed from the usual" })).toBeNull();
  });

  it("says why when the backend refuses, and keeps what was there", async () => {
    render(<AgentLimits />);
    const steps = await loaded("Steps in one go");
    chat.setBudgets = async () => {
      throw new Error("Steps must be from 1 to 1000");
    };
    typeInto(steps, "5");
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Steps must be from 1 to 1000"));
    expect(chat.budgetValues.rounds).toBe(80);
  });
});

const worked: RequestOutcome = { at: new Date(2026, 9, 12, 14, 5, 9).getTime(), provider: "chatgpt", model: "gpt-5", route: "chatgpt.com/backend-api/codex/responses", ok: true, stage: "stream", status: 200, kind: null, reason: "", attempts: 1, firstByteMs: 520, totalMs: 4210, renewed: true, rebuilt: false };
const failed: RequestOutcome = { at: new Date(2026, 9, 12, 14, 4, 9).getTime(), provider: "openai", model: "local-model", route: "localhost:8000/v1/chat/completions", ok: false, stage: "request", status: 503, kind: "connection", reason: "closed", attempts: 4, firstByteMs: null, totalMs: 9400, renewed: false, rebuilt: true };

describe("Connection report", () => {
  it("lists the last requests, newest first, in words", async () => {
    chat.outcomes = [worked, failed];
    render(<ConnectionReport />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["14:05:09", "chatgpt · gpt-5", "Answer", "Worked", "1 try, token renewed", "520 ms to the first word, 4.2 s in all"]);
    expect(within(rows[1]!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["14:04:09", "openai · local-model", "Request", "Failed: connection (503, closed)", "4 tries, connection made again", "9.4 s in all"]);
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Time", "Model", "Reached", "Result", "Tries", "Speed"]);
  });

  it("copies a report with nothing private in it", async () => {
    chat.outcomes = [worked, failed];
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    render(<ConnectionReport />);
    await screen.findByRole("table");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy report" })));
    expect(write).toHaveBeenCalledOnce();
    const text = (write.mock.calls[0] as unknown as [string])[0];
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("Failed: connection (503, closed)");
    expect(text).not.toMatch(/@|Bearer|sk-/i);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("clears the report", async () => {
    chat.outcomes = [worked];
    render(<ConnectionReport />);
    await screen.findByRole("table");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Clear" })));
    expect(chat.clearedOutcomes).toBe(1);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/No requests yet/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Copy report" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reads it again on Refresh", async () => {
    render(<ConnectionReport />);
    expect(await screen.findByText(/No requests yet/)).toBeTruthy();
    chat.outcomes = [worked];
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })));
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("says when it cannot be read", async () => {
    chat.diagnostics = async () => {
      throw new Error("The report could not be read");
    };
    render(<ConnectionReport />);
    expect((await screen.findByRole("alert")).textContent).toBe("The report could not be read");
  });
});
