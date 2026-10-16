// Following a kasten: link opens a place and nothing else: a page at its
// heading, a PDF at its page, a board at its card, a deck; one whose target
// is gone says so and writes nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardInfo, DeckInfo, SourceInfo } from "../../lib/vault/types";
import { openKastenLink } from "./open-kasten-link";
import { usePageJump } from "./page/jump";
import { usePlaceRequests } from "./place-requests";
import { MemoryVault } from "./preview/memory-vault";
import { useWorkspace } from "./store";

const PLAN = "01JPLANPLANPLANPLANPLAN01";
const WRITES = ["create", "saveBody", "trash", "setMeta", "append", "capture", "move", "rename", "updateProps", "setTags", "createBoard", "createDeck", "createCollection", "updateCollection", "trashCollection"] as const;

let vault: MemoryVault;
const toast = vi.fn();
const openPath = vi.fn();
const go = vi.fn();

beforeEach(async () => {
  vault = new MemoryVault({ "library/plan.md": `---\nid: ${PLAN}\ntitle: Plan\n---\n## Risks\n\nText.\n` });
  vi.spyOn(vault, "sources").mockResolvedValue([{ path: "sources/primer.pdf" }] as SourceInfo[]);
  vi.spyOn(vault, "boards").mockResolvedValue([{ path: "boards/map.canvas" }] as BoardInfo[]);
  vi.spyOn(vault, "decks").mockResolvedValue([{ path: "library/talk.deck" }] as DeckInfo[]);
  useWorkspace.setState({ client: vault, notes: await vault.list(), toast, openPath, go });
  usePageJump.setState({ jump: null });
  usePlaceRequests.setState({ board: null });
  toast.mockClear();
  openPath.mockClear();
  go.mockClear();
});
afterEach(() => vi.restoreAllMocks());

type Op = (...args: unknown[]) => unknown;
const noWrites = () => WRITES.map((name) => vi.spyOn(vault as unknown as Record<string, Op>, name));

describe("openKastenLink", () => {
  it("opens a page by its id, whatever its path is now", async () => {
    await openKastenLink(`kasten:note/${PLAN}`);
    expect(openPath).toHaveBeenCalledWith("library/plan.md", undefined);
    expect(toast).not.toHaveBeenCalled();
  });

  it("opens a page at a heading, or at the nth heading of a title, in the way asked", async () => {
    await openKastenLink(`kasten:note/${PLAN}#Risks`, "tab");
    expect(openPath).toHaveBeenLastCalledWith("library/plan.md", "tab");
    expect(usePageJump.getState().jump).toMatchObject({ path: "library/plan.md", heading: "Risks" });
    expect(usePageJump.getState().jump?.nth).toBeUndefined();
    await openKastenLink(`kasten:note/${PLAN}?section=Risks&n=2`);
    expect(usePageJump.getState().jump).toMatchObject({ path: "library/plan.md", heading: "Risks", nth: 2 });
  });

  it("says a page is missing, or in the trash, and runs no op", async () => {
    const writes = noWrites();
    await openKastenLink("kasten:note/01JGONEGONEGONEGONEGONE01");
    expect(toast).toHaveBeenLastCalledWith(expect.stringMatching(/not in the vault any more.*trash/));
    expect(openPath).not.toHaveBeenCalled();
    // A page in the trash is not among the notes.
    await vault.trash("library/plan.md");
    useWorkspace.setState({ notes: await vault.list() });
    toast.mockClear();
    writes.forEach((spy) => spy.mockClear());
    await openKastenLink(`kasten:note/${PLAN}#Risks`);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(openPath).not.toHaveBeenCalled();
    expect(writes.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it("opens a PDF at its page and highlight", async () => {
    await openKastenLink("kasten:pdf/sources/primer.pdf?page=4&highlight=h-1", "tab");
    expect(go).toHaveBeenCalledWith({ view: "highlights", path: "sources/primer.pdf" }, "tab");
    await openKastenLink("kasten:pdf/sources/gone.pdf?page=1");
    expect(toast).toHaveBeenLastCalledWith("That PDF is not in the vault any more");
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("opens a board and asks it to bring a card or section into view", async () => {
    await openKastenLink("kasten:board/boards/map.canvas?node=n-3");
    expect(openPath).toHaveBeenCalledWith("boards/map.canvas", undefined);
    expect(usePlaceRequests.getState().board).toMatchObject({ path: "boards/map.canvas", node: "n-3" });
    openPath.mockClear();
    usePlaceRequests.setState({ board: null });
    await openKastenLink("kasten:board/boards/gone.canvas?node=n-3");
    expect(openPath).not.toHaveBeenCalled();
    expect(usePlaceRequests.getState().board).toBeNull();
    expect(toast).toHaveBeenLastCalledWith(expect.stringMatching(/whiteboard is not in the vault/));
  });

  it("opens a deck by its path", async () => {
    await openKastenLink("kasten:deck/library/talk.deck?slide=s1");
    expect(openPath).toHaveBeenCalledWith("library/talk.deck", undefined);
    await openKastenLink("kasten:deck/library/none.deck");
    expect(toast).toHaveBeenLastCalledWith(expect.stringMatching(/deck is not in the vault/));
  });

  it("says so for a link it cannot read, and for a lookup that fails", async () => {
    await openKastenLink("kasten:pdf/../secret.pdf");
    expect(toast).toHaveBeenLastCalledWith("That link is not one KastenFlow can open");
    vi.spyOn(vault, "boards").mockRejectedValue(new Error("The vault is busy"));
    await openKastenLink("kasten:board/boards/map.canvas");
    expect(toast).toHaveBeenLastCalledWith("The vault is busy");
    expect(openPath).not.toHaveBeenCalled();
  });
});
