// Leaving a page and coming back while its last typing is still being written:
// the page reads the note only after that write lands, so it never starts from
// the older file and then merges its own typing into it.

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../preview/memory-vault";
import type { PageSession } from "./page-session";
import { useNoteSession, type LoadedNote } from "./use-note-session";
import { writeUnsavedNow } from "./unsaved";

const PAGE = "---\nid: 01K5Y2WE1C0MEPAGE000000001\ntitle: Notes\n---\nFirst line\n";

afterEach(() => {
  cleanup();
  writeUnsavedNow();
});

describe("a page opened again while its last typing is being written", () => {
  it("shows the note as written, not the file from before the write", async () => {
    const vault = new MemoryVault({ "library/notes.md": PAGE });
    const seen = {} as { loaded?: LoadedNote | null; session?: PageSession | null };
    function Probe() {
      const { loaded, session } = useNoteSession(vault, "library/notes.md");
      seen.loaded = loaded;
      seen.session = session.current;
      return null;
    }
    const view = render(<Probe key="first" />);
    await waitFor(() => expect(seen.loaded?.body).toBe("First line\n"));

    // The write on leaving is held back until the page has been opened again.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const save = vault.saveBody.bind(vault);
    vi.spyOn(vault, "saveBody").mockImplementationOnce(async (...args) => {
      await gate;
      return save(...args);
    });
    seen.session!.editBody("Typed before leaving\n");
    view.rerender(null);
    view.rerender(<Probe key="second" />);
    await act(async () => {
      await Promise.resolve();
    });

    release();
    await waitFor(() => expect(seen.loaded?.body).toBe("Typed before leaving\n"));
    expect(seen.loaded?.note.hash).toBe((await vault.read("library/notes.md")).hash);
  });
});
