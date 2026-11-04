// The palette shows full-text hits for what is typed now, never the hits of an
// earlier query while the newer one is still being searched, or after it failed.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Hit } from "../../../lib/vault/types";
import { MemoryVault } from "../preview/memory-vault";
import { derive } from "../store-layout";
import { useWorkspace } from "../store";
import { initialLayout } from "../tabs";
import { Palette } from "./Palette";

const hit = (path: string, snippet: string): Hit => ({ path, title: path, icon: null, snippet, score: 1 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  localStorage.clear();
  const vault = new MemoryVault({ "library/kiln.md": "---\ntitle: Kiln firing\n---\nStoneware.\n" });
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], recent: [], toasts: [] });
});
afterEach(cleanup);

const type = (text: string) => fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: text } });
const client = () => useWorkspace.getState().client!;

describe("the palette's text hits", () => {
  it("drops the hits of the earlier query while the newer one is searched", async () => {
    const later = deferred<Hit[]>();
    const search = vi.spyOn(client(), "search").mockImplementation((q) => (q === "ab" ? Promise.resolve([hit("library/old.md", "snippet of ab")]) : later.promise));
    render(<Palette />);
    type("ab");
    await screen.findByText("snippet of ab");
    type("abc");
    await waitFor(() => expect(search).toHaveBeenCalledWith("abc", 12));
    expect(screen.queryByText("snippet of ab")).toBeNull();
    later.resolve([hit("library/new.md", "snippet of abc")]);
    await screen.findByText("snippet of abc");
    expect(screen.queryByText("snippet of ab")).toBeNull();
  });

  it("drops the hits of the earlier query when the newer search fails", async () => {
    const search = vi.spyOn(client(), "search").mockImplementation((q) => (q === "ab" ? Promise.resolve([hit("library/old.md", "snippet of ab")]) : Promise.reject(new Error("no index"))));
    render(<Palette />);
    type("ab");
    await screen.findByText("snippet of ab");
    type("abc");
    await waitFor(() => expect(search).toHaveBeenCalledWith("abc", 12));
    await waitFor(() => expect(screen.queryByText("snippet of ab")).toBeNull());
  });
});
