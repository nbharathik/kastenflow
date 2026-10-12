import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDeck } from "../filmstrip/test-support.ts";
import { NotesPane } from "./NotesPane.tsx";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup() {
  const made = await openDeck({ slides: 2 });
  render(
    <div className="ks-editor">
      <NotesPane session={made.session} ui={made.ui} />
    </div>,
  );
  return made;
}

describe("folding the notes away", () => {
  it("has a strip over the notes that folds them, leaving a bar to bring them back", async () => {
    const { ui } = await setup();
    expect(screen.getByRole("textbox", { name: "Speaker notes for this slide" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide speaker notes" }));
    expect(ui.state.notesOpen).toBe(false);
    expect(screen.queryByRole("textbox", { name: "Speaker notes for this slide" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show speaker notes" }));
    expect(ui.state.notesOpen).toBe(true);
    expect(screen.getByRole("textbox", { name: "Speaker notes for this slide" })).toBeTruthy();
  });

  it("follows the setting when it is changed from the menu or a key", async () => {
    const { ui } = await setup();
    act(() => ui.toggleNotes());
    expect(screen.getByRole("button", { name: "Show speaker notes" })).toBeTruthy();
    act(() => ui.toggleNotes());
    expect(screen.getByRole("button", { name: "Hide speaker notes" })).toBeTruthy();
  });

  it("keeps what was typed when the notes are folded and opened again", async () => {
    const { ui, session } = await setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Speaker notes for this slide" }), { target: { value: "Open with a question" } });
    act(() => ui.toggleNotes());
    // The words are written to the slide as the notes leave.
    expect(session.slide.notes).toBe("Open with a question");
    act(() => ui.toggleNotes());
    expect((screen.getByRole("textbox", { name: "Speaker notes for this slide" }) as HTMLTextAreaElement).value).toBe("Open with a question");
  });
});
