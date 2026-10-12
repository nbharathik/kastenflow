import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MNEMONICS, MenuBar } from "./MenuBar.tsx";
import { nextFrame, openEditor } from "./testing.ts";

afterEach(cleanup);

async function setup() {
  const editor = await openEditor();
  render(
    <div className="ks-editor">
      <button type="button" data-testid="stage">
        slide
      </button>
      <MenuBar session={editor.session} ui={editor.ui} />
    </div>,
  );
  const stage = screen.getByTestId("stage");
  stage.focus();
  return { ...editor, stage };
}

/** Alt and a letter, as the keyboard reports it. */
const alt = (letter: string, extra: object = {}) => fireEvent.keyDown(document.activeElement ?? document.body, { key: letter.toLowerCase(), code: `Key${letter}`, altKey: true, ...extra });

describe("Alt and a letter", () => {
  it("names a menu for each letter, one each", () => {
    expect(Object.values(MNEMONICS).sort()).toEqual(["arrange", "edit", "file", "format", "help", "insert", "slide", "tools", "view"]);
  });

  it("opens the menu of that letter, with its first row ready for the arrow keys", async () => {
    await setup();
    alt("F");
    await nextFrame();
    const menu = screen.getByRole("dialog", { name: "File" });
    expect(menu).toBeTruthy();
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it("moves to another menu when another letter is pressed, and the letters are those of Google Slides", async () => {
    await setup();
    alt("O");
    expect(screen.getByRole("dialog", { name: "Format" })).toBeTruthy();
    alt("D");
    expect(screen.getByRole("dialog", { name: "Slide" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Format" })).toBeNull();
    alt("A");
    expect(screen.getByRole("dialog", { name: "Arrange" })).toBeTruthy();
  });

  it("is left to the page when the focus is outside the editor, or Shift or Control is held, or it is another letter", async () => {
    const { stage } = await setup();
    alt("F", { shiftKey: true });
    alt("F", { ctrlKey: true });
    alt("Q");
    expect(screen.queryByRole("dialog")).toBeNull();
    const outside = document.body.appendChild(document.createElement("button"));
    outside.focus();
    alt("F");
    expect(screen.queryByRole("dialog")).toBeNull();
    outside.remove();
    stage.focus();
    act(() => void alt("F"));
    expect(screen.getByRole("dialog", { name: "File" })).toBeTruthy();
  });

  it("claims the key, so the page does not use it", async () => {
    await setup();
    const proceeded = alt("E");
    expect(proceeded).toBe(false);
  });
});
