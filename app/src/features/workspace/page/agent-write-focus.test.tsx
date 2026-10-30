// An agent writing to the page being typed in never moves the person: the
// reload that takes the write in puts the caret and the scroll position back
// where they were, and takes no focus from where the person is typing.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { filesChanged, setPageView } from "./open-page";
import { NotePage } from "./NotePage";
import type { PageSession } from "./page-session";
import { useNoteSession, type LoadedNote } from "./use-note-session";
import { writeUnsavedNow } from "./unsaved";

const PATH = "library/plan.md";
const TEXT = "---\ntitle: Plan\n---\nFirst paragraph.\n\nSecond paragraph.\n";
const ADDED = "Added by the agent.";

let vault: MemoryVault;

beforeEach(() => {
  localStorage.clear();
  vault = new MemoryVault({ [PATH]: TEXT });
});
afterEach(() => {
  cleanup();
  writeUnsavedNow();
});

describe("the reload that takes an agent's write in", () => {
  const seen: { loaded: LoadedNote | null; session: PageSession | null } = { loaded: null, session: null };

  /** The page's session, with an editor that reports the reader at caret 17 and scroll 300. */
  function Probe() {
    const { loaded, session } = useNoteSession(vault, PATH);
    seen.loaded = loaded;
    seen.session = session.current;
    useEffect(() => {
      if (session.current) setPageView(session.current, () => ({ caret: 17, scroll: 300 }));
    }, [loaded?.version, session]);
    return null;
  }

  beforeEach(() => {
    seen.loaded = null;
    seen.session = null;
  });

  it("puts the caret and the scroll back where the reader was", async () => {
    render(<Probe />);
    await waitFor(() => expect(seen.loaded?.body).toBe("First paragraph.\n\nSecond paragraph.\n"));
    const first = seen.loaded!.version;
    await vault.append(PATH, ADDED);
    act(() => filesChanged([PATH]));
    await waitFor(() => expect(seen.loaded?.body).toContain(ADDED));
    expect(seen.loaded!.version).toBeGreaterThan(first);
    expect(seen.loaded!.keep).toEqual({ caret: 17, scroll: 300 });
  });

  it("keeps the reader's place and their typing when the write lands while they type", async () => {
    render(<Probe />);
    await waitFor(() => expect(seen.loaded?.body).toBe("First paragraph.\n\nSecond paragraph.\n"));
    // Typing waits to be saved when the agent's write arrives.
    seen.session!.editBody("First paragraph, typed.\n\nSecond paragraph.\n");
    await vault.append(PATH, ADDED);
    act(() => filesChanged([PATH]));
    // Nothing reloads under the person's hands: their text stands until it is saved.
    expect(seen.loaded!.body).toBe("First paragraph.\n\nSecond paragraph.\n");
    await act(async () => {
      await seen.session!.flush();
    });
    await waitFor(() => expect(seen.loaded?.body).toContain(ADDED));
    expect(seen.loaded!.body).toContain("First paragraph, typed.");
    expect(seen.loaded!.keep).toEqual({ caret: 17, scroll: 300 });
  });
});

describe("a page in the window", () => {
  it("keeps its scroll position, and focus stays where the person types", async () => {
    await useWorkspace.getState().connect({ client: vault });
    useWorkspace.getState().openPath(PATH);
    render(
      <>
        <NotePage client={vault} path={PATH} />
        <textarea aria-label="Chat message" />
      </>,
    );
    const editor = await screen.findByTestId("page-editor", {}, { timeout: 20_000 });
    await expect.poll(() => editor.textContent, { timeout: 20_000 }).toContain("Second paragraph.");
    const scroller = document.querySelector<HTMLElement>(".kasten-page-main")!;
    scroller.scrollTop = 240;
    const message = screen.getByRole("textbox", { name: "Chat message" });
    message.focus();

    await vault.append(PATH, ADDED);
    act(() => filesChanged([PATH]));
    await expect.poll(() => screen.getByTestId("page-editor").textContent, { timeout: 20_000 }).toContain(ADDED);

    expect(document.querySelector<HTMLElement>(".kasten-page-main")!.scrollTop).toBe(240);
    expect(document.activeElement).toBe(message);
  });
});
