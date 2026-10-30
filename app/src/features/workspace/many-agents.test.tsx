// Five agents writing to five different notes while the person types a
// message: every key lands, the box keeps the focus and stays the same
// element, and each write is taken in. Scripted against the in-memory vault
// only; nothing here touches a real one.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatDock } from "../chat/ChatDock";
import { resetChat, scriptedChat } from "../chat/test-kit";
import { useBoards } from "../boards/store";
import { useTags } from "../tags/store";
import { MemoryVault } from "./preview/memory-vault";
import { filesChanged } from "./page/open-page";
import { useWorkspace } from "./store";

const AGENT_NOTES = [1, 2, 3, 4, 5].map((n) => `library/agent-${n}.md`);
const SEED: Record<string, string> = { "library/plan.md": "---\ntitle: Plan\n---\nMy plan.\n" };
for (const path of AGENT_NOTES) SEED[path] = `---\ntitle: ${path.slice(8, -3)}\n---\nStart.\n`;

const SENTENCE = "Please compare the five notes and tell me which one is the longest, then list what each says about the plan.";

beforeEach(() => {
  localStorage.clear();
  resetChat(scriptedChat());
  useBoards.setState({ list: [], loaded: false });
  useTags.setState({ schemas: null });
});
afterEach(cleanup);

describe("agents writing while the person types", () => {
  it("drops no key and takes no focus", async () => {
    const vault = new MemoryVault(SEED);
    const notesAt = vi.spyOn(vault, "notesAt");
    await useWorkspace.getState().connect({ client: vault });
    useWorkspace.getState().openPath("library/plan.md");
    render(<ChatDock />);
    const box = (await screen.findByRole("textbox", { name: "Message" })) as HTMLTextAreaElement;
    box.focus();
    expect(document.activeElement).toBe(box);

    let typed = "";
    let writes = 0;
    for (const char of SENTENCE) {
      typed += char;
      fireEvent.change(box, { target: { value: typed } });
      // Each key is followed by one of the five agents' writes, in turn; the open page gets one too.
      if (typed.length % 3 === 0) {
        const path = AGENT_NOTES[writes % AGENT_NOTES.length]!;
        await vault.append(path, `Agent line ${writes}.`);
        writes++;
        await act(async () => {
          filesChanged([path, "library/plan.md"]);
          await useWorkspace.getState().filesChanged([path]);
        });
      }
      // The same box, holding every key typed so far, with the focus where it was.
      expect(screen.getByRole("textbox", { name: "Message" })).toBe(box);
      expect(box.value).toBe(typed);
      expect(document.activeElement).toBe(box);
    }
    expect(writes).toBeGreaterThanOrEqual(30);
    expect(box.value).toBe(SENTENCE);
    // Every write was looked at by the list.
    expect(notesAt.mock.calls.length).toBe(writes);
    // And all of them are in the vault, none lost to another.
    for (const [i, path] of AGENT_NOTES.entries()) {
      const body = (await vault.read(path)).text;
      for (let n = i; n < writes; n += AGENT_NOTES.length) expect(body).toContain(`Agent line ${n}.`);
    }
  }, 60_000);

  it("keeps the focus in a field of the page's own details while notes change", async () => {
    const vault = new MemoryVault(SEED);
    await useWorkspace.getState().connect({ client: vault });
    render(
      <>
        <input aria-label="A property" />
        <ChatDock />
      </>,
    );
    const field = screen.getByRole("textbox", { name: "A property" }) as HTMLInputElement;
    field.focus();
    for (const [i, path] of AGENT_NOTES.entries()) {
      await vault.append(path, `More ${i}.`);
      await act(async () => {
        await useWorkspace.getState().filesChanged([path]);
      });
      fireEvent.change(field, { target: { value: `v${i}` } });
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe(`v${i}`);
    }
  });
});
