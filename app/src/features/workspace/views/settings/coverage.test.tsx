// The index and the pages stay in step: every row a group draws names a
// setting in the index, and every setting the index offers in this app is
// drawn by its group, so search, navigation and the page cannot drift apart.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetChat, scriptedChat } from "../../../chat/test-kit";
import { MemoryVault } from "../../preview/memory-vault";
import { useWorkspace } from "../../store";
import { ENTRIES, entryById, GROUPS, isOffered, searchSettings } from "./index";
import { wordsOf } from "./search";
import { GroupPage, Results } from "./SettingsPage";

beforeEach(async () => {
  localStorage.clear();
  resetChat(scriptedChat([]));
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
});
afterEach(cleanup);

async function drawn(group: (typeof GROUPS)[number]): Promise<string[]> {
  const { container } = render(<GroupPage group={group.id} flash={null} open={() => {}} onSwitchVault={() => {}} />);
  // What a group reads when it opens (providers, the vault's settings) arrives a moment later.
  for (let i = 0; i < 3; i++) await act(async () => {});
  return [...container.querySelectorAll<HTMLElement>("[data-setting]")].map((e) => e.dataset.setting!);
}

describe("the index and the pages", () => {
  for (const group of GROUPS) {
    it(`${group.title}: every row names a setting of the index, once, and every setting this app offers is drawn`, async () => {
      const ids = await drawn(group);
      for (const id of ids) expect(entryById(id), `${id} is not in the index`).toBeDefined();
      expect(new Set(ids).size, `a row of ${group.title} is drawn twice`).toBe(ids.length);
      const missing = ENTRIES.filter((e) => e.group === group.id && isOffered(e, false)).filter((e) => !ids.includes(e.id));
      expect(
        missing.map((e) => e.id),
        `${group.title} does not draw`,
      ).toEqual([]);
    });
  }

  for (const group of GROUPS) {
    it(`${group.title}: a search for its name finds every setting in the cards the page draws them in`, async () => {
      // The group's name is in every one of its entries, so each is found.
      const found = searchSettings(group.title, false);
      const { container } = render(<Results found={found} query={group.title} words={wordsOf(group.title)} flash={null} open={() => {}} onSwitchVault={() => {}} onClear={() => {}} />);
      for (let i = 0; i < 3; i++) await act(async () => {});
      const ids = new Set([...container.querySelectorAll<HTMLElement>("[data-setting]")].map((e) => e.dataset.setting!));
      const missing = ENTRIES.filter((e) => e.group === group.id && found.ids.has(e.id)).filter((e) => !ids.has(e.id) && !container.querySelector(`[aria-label="Open ${e.label} in ${group.title}"]`));
      expect(
        missing.map((e) => e.id),
        `${group.title}: found but not drawn (a card named differently on the page and in the index?)`,
      ).toEqual([]);
    });
  }

  it("draws no setting of the desktop app in the browser preview, and the preview's stand-ins for them", async () => {
    const all: string[] = [];
    for (const group of GROUPS) all.push(...(await drawn(group)));
    for (const entry of ENTRIES.filter((e) => e.only === "desktop")) expect(all, entry.id).not.toContain(entry.id);
    for (const entry of ENTRIES.filter((e) => e.only === "preview")) expect(all, entry.id).toContain(entry.id);
  });
});
