// Window-wide saves (quit, restart, switching vault, backup, restore) write the
// open deck too, as they do open pages.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { SlidesEditorProps } from "@kasten-slides/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushOpenPage } from "../workspace/page/open-page";
import { useWorkspace } from "../workspace/store";
import { DeckView } from "./DeckView";
import { resetDeckUi } from "./deck-ui";

const seen = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("@kasten-slides/react", async (original) => ({
  ...(await original<typeof import("@kasten-slides/react")>()),
  SlidesEditor: (props: SlidesEditorProps) => {
    seen.push(props as unknown as Record<string, unknown>);
    return <div data-testid="editor" />;
  },
}));
vi.mock("./AiTab", () => ({ AiTab: () => null }));

const DECK = "decks/talk.deck";

beforeEach(() => {
  seen.length = 0;
  useWorkspace.setState({ notes: [], toasts: [], client: { deck: () => Promise.resolve({ path: DECK, text: "{}", hash: "h" }) } as never });
});
afterEach(() => {
  cleanup();
  resetDeckUi();
});

const open = async () => {
  render(<DeckView path={DECK} />);
  await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
  return (session: unknown) => act(() => (seen.at(-1)!.onSession as (s: unknown, u: unknown) => void)(session, session ? {} : null));
};

describe("the open deck when the open pages are written", () => {
  it("is saved before the write of the open pages is done", async () => {
    const attach = await open();
    let release!: () => void;
    const flush = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    attach({ flush });
    let done = false;
    const all = flushOpenPage().then(() => (done = true));
    await Promise.resolve();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    release();
    await all;
    expect(done).toBe(true);
  });

  it("is no longer written once the editor is gone", async () => {
    const attach = await open();
    const flush = vi.fn(async () => {});
    attach({ flush });
    attach(null);
    await flushOpenPage();
    expect(flush).not.toHaveBeenCalled();
  });

  it("is no longer written once the tab is closed", async () => {
    const attach = await open();
    const flush = vi.fn(async () => {});
    attach({ flush });
    cleanup();
    await flushOpenPage();
    expect(flush).not.toHaveBeenCalled();
  });
});
