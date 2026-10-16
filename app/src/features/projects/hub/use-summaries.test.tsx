import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "../../../lib/vault/project-types";
import type { VaultClient } from "../../../lib/vault/types";
import { applyRevision, NO_REVISION, useRevision } from "../../workspace/revision";
import { useWorkspace } from "../../workspace/store";
import { summary } from "./test-support";
import { useSummaries } from "./use-summaries";

function Probe() {
  const { list, error, reload } = useSummaries();
  return (
    <div>
      <p data-testid="list">{list === null ? "loading" : list.map((s) => s.title).join(",")}</p>
      <p data-testid="error">{error ?? ""}</p>
      <button type="button" onClick={reload}>
        reload
      </button>
    </div>
  );
}

const withClient = (projectSummaries: (today?: string) => Promise<ProjectSummary[]>) => useWorkspace.setState({ client: { projectSummaries } as unknown as VaultClient });

beforeEach(() => {
  useWorkspace.setState({ client: null });
  useRevision.setState({ revision: NO_REVISION });
});
afterEach(cleanup);

describe("reading the project summaries", () => {
  it("asks once for every project, with the person's day, and keeps the answer", async () => {
    const ask = vi.fn(async (_today?: string) => [summary("a"), summary("b")]);
    withClient(ask);
    render(<Probe />);
    expect(screen.getByTestId("list").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("list").textContent).toBe("A,B"));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("asks again when notes, boards or decks change, keeping the old list on screen meanwhile", async () => {
    let answer = [summary("a")];
    const ask = vi.fn(async () => answer);
    withClient(ask);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("list").textContent).toBe("A"));
    answer = [summary("a"), summary("b")];
    act(() => applyRevision({ ...NO_REVISION, all: 1, notes: 1 }));
    expect(screen.getByTestId("list").textContent).toBe("A");
    await waitFor(() => expect(screen.getByTestId("list").textContent).toBe("A,B"));
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("does not ask again for a change to something a project is not made of", async () => {
    const ask = vi.fn(async () => [summary("a")]);
    withClient(ask);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("list").textContent).toBe("A"));
    act(() => applyRevision({ ...NO_REVISION, all: 1, tags: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("asks again on request, and says when it could not", async () => {
    const ask = vi.fn(async () => {
      throw new Error("The index is being rebuilt");
    });
    withClient(ask);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("The index is being rebuilt"));
    expect(screen.getByTestId("list").textContent).toBe("loading");
    ask.mockImplementation(async () => [summary("a")] as never);
    act(() => screen.getByRole("button", { name: "reload" }).click());
    await waitFor(() => expect(screen.getByTestId("list").textContent).toBe("A"));
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("is quiet and empty without a vault", () => {
    render(<Probe />);
    expect(screen.getByTestId("list").textContent).toBe("loading");
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("reads the newest answer when two are in flight", async () => {
    const resolvers: ((list: ProjectSummary[]) => void)[] = [];
    const ask = vi.fn(() => new Promise<ProjectSummary[]>((resolve) => resolvers.push(resolve)));
    withClient(ask);
    render(<Probe />);
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    act(() => screen.getByRole("button", { name: "reload" }).click());
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolvers[1]!([summary("new")]);
    });
    await act(async () => {
      resolvers[0]!([summary("old")]);
    });
    expect(screen.getByTestId("list").textContent).toBe("New");
  });
});
