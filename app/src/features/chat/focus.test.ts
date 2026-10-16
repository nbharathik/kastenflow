// The chat's key: open the dock, then go to its message box, then close it.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import { DEFAULT_KEYS } from "../shortcuts/keymap";
import { COMMANDS } from "../workspace/overlays/commands";
import { chatShortcut } from "./focus";

function page() {
  document.body.innerHTML = '<input id="elsewhere" /><aside class="kasten-chat-dock"><textarea aria-label="Message"></textarea></aside>';
  return { elsewhere: document.getElementById("elsewhere") as HTMLInputElement, box: document.querySelector("textarea") as HTMLTextAreaElement };
}

beforeEach(() => useShell.setState({ chatOpen: false }));
afterEach(() => {
  document.body.innerHTML = "";
});

describe("the chat shortcut", () => {
  it("opens the dock; with it open and the cursor elsewhere, goes to its box; from the box, closes it", () => {
    const { elsewhere, box } = page();
    elsewhere.focus();
    chatShortcut();
    expect(useShell.getState().chatOpen).toBe(true);
    // The dock opens with the cursor in its box (the box asks for it).
    elsewhere.focus();
    chatShortcut();
    expect(document.activeElement).toBe(box);
    expect(useShell.getState().chatOpen).toBe(true);
    chatShortcut();
    expect(useShell.getState().chatOpen).toBe(false);
  });

  it("closes the dock when no box is on the page to go to", () => {
    useShell.setState({ chatOpen: true });
    chatShortcut();
    expect(useShell.getState().chatOpen).toBe(false);
  });

  it("is the command on Mod+Shift+A", () => {
    const { elsewhere, box } = page();
    expect(DEFAULT_KEYS["chat-dock"]).toEqual(["Mod+Shift+A"]);
    useShell.setState({ chatOpen: true });
    elsewhere.focus();
    COMMANDS.find((c) => c.id === "chat-dock")!.run();
    expect(document.activeElement).toBe(box);
  });
});
