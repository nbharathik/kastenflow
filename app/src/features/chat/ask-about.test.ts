// Asking AI about a page: from its menu, a new chat in the dock with the
// page attached; from anywhere, Mod+Shift+A opens or closes the dock.

import { beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import type { NoteMeta } from "../../lib/vault/types";
import { DEFAULT_KEYS } from "../shortcuts/keymap";
import { COMMANDS } from "../workspace/overlays/commands";
import { askAboutPage } from "./ask-page";
import { useChat } from "./store";
import { resetChat, scriptedChat } from "./test-kit";

const PAGE = { path: "library/trip.md", title: "Trip", kind: "page" } as NoteMeta;

beforeEach(() => {
  resetChat(scriptedChat());
  useShell.setState({ chatOpen: false });
});

describe("asking AI about a page", () => {
  it("starts a chat in the dock with the page attached", async () => {
    await askAboutPage(PAGE);
    expect(useShell.getState().chatOpen).toBe(true);
    const { active, threads } = useChat.getState();
    expect(threads[active!]!.context.map((chip) => chip.ref)).toEqual([["library/trip.md"]]);
  });

  it("opens and closes the dock from the keyboard", () => {
    expect(DEFAULT_KEYS["chat-dock"]).toEqual(["Mod+Shift+A"]);
    const command = COMMANDS.find((c) => c.id === "chat-dock")!;
    command.run();
    expect(useShell.getState().chatOpen).toBe(true);
    command.run();
    expect(useShell.getState().chatOpen).toBe(false);
  });
});
