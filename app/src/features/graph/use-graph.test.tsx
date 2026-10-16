// The graph asks again when a board, a deck or a diagram changes, not only when
// a note does: it follows the vault's change counters.

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../workspace/preview/memory-vault";
import { applyRevision, loadRevision, resetRevision } from "../workspace/revision";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { useVaultGraph } from "./use-graph";

const SEED = {
  "library/alpha.md": "---\ntitle: Alpha\n---\nSee [[Beta]].\n",
  "library/beta.md": "---\ntitle: Beta\n---\nBack to [[Alpha]].\n",
};

let vault: MemoryVault;
let stop: () => void;

beforeEach(async () => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  // What the window does once it is open (workspace/status.ts).
  stop = vault.watch({ changed() {}, committed() {}, error() {}, revised: applyRevision });
  loadRevision(vault);
});

afterEach(() => {
  stop();
  resetRevision();
  cleanup();
});

describe("the graph hook", () => {
  it("is asked for again when a board is made, which no note shows", async () => {
    const ask = vi.spyOn(vault, "graph");
    const { result } = renderHook(() => useVaultGraph({ kind: "vault" }));
    await waitFor(() => expect(result.current.graph?.nodes.length).toBe(2));
    const first = ask.mock.calls.length;
    await act(async () => {
      await vault.createBoard("Map", null);
    });
    // After the quiet spell the hook waits for before asking again.
    await waitFor(() => expect(ask.mock.calls.length).toBeGreaterThan(first), { timeout: 4000 });
    await waitFor(() => expect(result.current.graph?.nodes.some((n) => n.kind === "board")).toBe(true), { timeout: 4000 });
  });
});
