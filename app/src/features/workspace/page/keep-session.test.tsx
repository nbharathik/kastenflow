// A page kept ready (hidden by a tab switch) closes its session; shown again it
// reads the note back and takes typing again, instead of showing old text and
// dropping what is typed.

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../preview/memory-vault";
import type { PageSession } from "./page-session";
import { useNoteSession } from "./use-note-session";
import { writeUnsavedNow } from "./unsaved";

const PAGE = "---\nid: 01K5Y2WE1C0MEPAGE000000001\ntitle: Notes\n---\nFirst line\n";

afterEach(() => {
  cleanup();
  writeUnsavedNow();
});

describe("a page kept ready", () => {
  it("is written when put away and takes typing again when shown", async () => {
    const vault = new MemoryVault({ "library/notes.md": PAGE });
    const seen: { body?: string; session?: PageSession | null } = {};
    function Probe() {
      const { loaded, session } = useNoteSession(vault, "library/notes.md");
      seen.body = loaded?.body;
      seen.session = session.current;
      return null;
    }
    const ui = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <Probe />
      </Activity>
    );
    const view = render(ui("visible"));
    await waitFor(() => expect(seen.body).toBe("First line\n"));

    // Typed, then the tab is put away: the text is written.
    seen.session!.editBody("Typed while shown\n");
    view.rerender(ui("hidden"));
    await waitFor(async () => expect((await vault.read("library/notes.md")).text).toContain("Typed while shown"));

    // Shown again: the page has what was written and a session that takes edits.
    view.rerender(ui("visible"));
    await waitFor(() => expect(seen.body).toBe("Typed while shown\n"));
    await act(async () => {
      seen.session!.editBody("Typed after coming back\n");
      await seen.session!.flush();
    });
    expect((await vault.read("library/notes.md")).text).toContain("Typed after coming back");
  });
});
