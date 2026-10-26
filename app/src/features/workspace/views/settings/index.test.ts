// The Settings index: every group and control the single long page had is
// still there, and a search finds settings by label, explanation or keyword.

import { describe, expect, it } from "vitest";

import { cardIds, ENTRIES, entryById, GROUPS, groupById, HEADINGS, resolveGroup, rowDomId, searchSettings, sectionId, settingsTarget } from "./index";
import { hasWords, pieces, wordsOf } from "./search";

/** The groups of the old page, in its words. */
const OLD_GROUPS = ["Appearance", "Pages", "Sidebar", "Calendar", "Diagrams", "Browser", "Browser extension", "Templates", "AI providers", "Search by meaning", "AI agents", "Vault", "History", "Desktop", "Keyboard shortcuts", "About"];

/** Every control of the old page: its group and its label. */
const OLD_CONTROLS: [group: string, label: string][] = [
  ["Appearance", "Theme"],
  ["Appearance", "Accent colour"],
  ["Appearance", "Interface size"],
  ["Appearance", "Motion"],
  ["Pages", "Font"],
  ["Pages", "Text size"],
  ["Pages", "Page width"],
  ["Pages", "Check spelling"],
  ["Pages", "Open pages in a new tab"],
  ["Pages", "Open pages from views in"],
  ["Pages", "Open links and sub-pages in"],
  ["Pages", "Open to the right"],
  ["Sidebar", "Show quick notes under projects"],
  ["Sidebar", "Views in the sidebar"],
  ["Calendar", "Weeks start on"],
  ["Calendar", "Journal"],
  ["Calendar", "Dated notes"],
  ["Calendar", "To-dos"],
  ["Calendar", "Mentions"],
  ["Calendar", "Made that day"],
  ["Calendar", "Subscribed calendars"],
  ["Calendar", "Subscribe to a calendar"],
  ["Diagrams", "Diagram editor"],
  ["Diagrams", "Credit"],
  ["Browser", "Use the browser"],
  ["Browser", "Search engine"],
  ["Browser", "Add a search engine"],
  ["Browser", "Favourite sites"],
  ["Browser", "Open web links in"],
  ["Browser", "Browsing data"],
  ["Browser", "Signing in"],
  ["Browser extension", "Let the browser extension reach KastenFlow"],
  ["Browser extension", "Port"],
  ["Browser extension", "Pair an extension"],
  ["Browser extension", "Paired extensions"],
  ["Browser extension", "Put the extension in Chrome or Edge"],
  ["Templates", "Templates"],
  ["Templates", "Journal days start from"],
  ["Templates", "Starter kits"],
  ["Templates", "New starter templates"],
  ["AI providers", "Providers"],
  ["AI providers", "Use your ChatGPT plan"],
  ["Search by meaning", "Provider"],
  ["Search by meaning", "Embedding model"],
  ["Search by meaning", "Vectors"],
  ["AI agents", "Connect Claude Code"],
  ["AI agents", "Claude Desktop, Cursor and other MCP apps"],
  ["AI agents", "Clients that connect by URL"],
  ["AI agents", "Changes waiting and past sessions"],
  ["AI agents", "Largest removal"],
  ["AI agents", "Notes changed in 10 minutes"],
  ["AI agents", "Notes trashed per session"],
  ["AI agents", "Cards removed from a board at once"],
  ["AI agents", "Slides taken out of decks in 10 minutes"],
  ["AI agents", "Largest single write"],
  ["AI agents", "Largest picture an agent may add"],
  ["AI agents", "Pictures added in 10 minutes"],
  ["AI agents", "Picture data added in 10 minutes"],
  ["Vault", "Notes live in"],
  ["Vault", "Import notes"],
  ["Vault", "Switch vault"],
  ["History", "Vault folder"],
  ["History", "History"],
  // Backup has its own group now, split from History.
  ["Backup", "Back up to GitHub"],
  ["Backup", "Backup remote"],
  ["Backup", "Get latest"],
  ["Backup", "Backup files"],
  ["Backup", "When to back up"],
  ["Backup", "Changes from other computers"],
  ["Backup", "Safety"],
  ["Backup", "What is not in the backup"],
  ["History", "Check the vault"],
  ["Desktop", "Keep running when the window closes"],
  ["Desktop", "Quick capture"],
  ["Desktop", "Notifications"],
  ["Keyboard shortcuts", "All shortcuts on one sheet"],
  ["Keyboard shortcuts", "Change a command's keys"],
  ["About", "KastenFlow"],
  ["About", "Updates"],
  ["About", "Check for new versions"],
  ["About", "Download new versions automatically"],
  ["About", "Open-source licences"],
];

describe("the index of groups", () => {
  it("has every group of the old page, under four headings, once each", () => {
    const titles = GROUPS.map((g) => g.title);
    for (const old of OLD_GROUPS) expect(titles, old).toContain(old);
    expect(new Set(GROUPS.map((g) => g.id)).size).toBe(GROUPS.length);
    expect(new Set(titles).size).toBe(titles.length);
    for (const g of GROUPS) expect(HEADINGS).toContain(g.heading);
    expect(GROUPS.map((g) => g.heading)).toEqual([...GROUPS.map((g) => g.heading)].sort((a, b) => HEADINGS.indexOf(a) - HEADINGS.indexOf(b)));
    // General, Connect, Data, System, as the navigation lists them.
    expect(HEADINGS).toEqual(["General", "Connect", "Data", "System"]);
  });

  it("has a Plugins group, under Data, found by name and by a word of its entry", () => {
    expect(groupById("plugins")).toMatchObject({ title: "Plugins", heading: "Data" });
    expect(resolveGroup("plugins")).toBe("plugins");
    expect(settingsTarget("settings/plugins")).toEqual({ group: "plugins" });
    expect(entryById("plugins.list")?.group).toBe("plugins");
    expect([...searchSettings("add-ons", false).ids]).toEqual(["plugins.list"]);
  });

  it("gives every group an icon, a one-line blurb and a name that finds it", () => {
    for (const g of GROUPS) {
      expect(g.icon, g.id).toBeTruthy();
      expect(g.blurb.length, g.id).toBeGreaterThan(0);
      expect(g.blurb.length, g.id).toBeLessThan(60);
      expect(resolveGroup(g.title), g.title).toBe(g.id);
      expect(resolveGroup(g.id), g.id).toBe(g.id);
    }
    expect(resolveGroup("  history AND backup ")).toBe("history");
    expect(resolveGroup("backup")).toBe("backup");
    expect(resolveGroup("Subscribed calendars")).toBe("calendar");
    expect(resolveGroup("nothing like it")).toBeNull();
  });
});

describe("the index of settings", () => {
  it("still has every control of the old page, in its group", () => {
    for (const [group, label] of OLD_CONTROLS) {
      const found = ENTRIES.some((e) => e.label === label && groupById(e.group).title === group);
      expect(found, `${group}: ${label}`).toBe(true);
    }
  });

  it("has unique ids that start with their group, and a group for each entry", () => {
    const ids = ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ENTRIES) {
      expect(e.id.startsWith(`${e.group}.`), e.id).toBe(true);
      expect(entryById(e.id)).toBe(e);
      expect(e.label.length, e.id).toBeGreaterThan(0);
    }
    // No two entries of a group share a label.
    for (const g of GROUPS) {
      const labels = ENTRIES.filter((e) => e.group === g.id).map((e) => e.label);
      expect(new Set(labels).size, g.id).toBe(labels.length);
    }
  });

  it("keeps each group's cards: its own, and the sub-cards its page names", () => {
    expect(cardIds("appearance", "Frequently used")).toEqual(["appearance.theme", "appearance.accent", "appearance.zoom"]);
    expect(cardIds("appearance", "Animation")).toEqual(["appearance.motion"]);
    expect(cardIds("calendar", "Subscribed calendars")).toEqual(["calendar.feeds", "calendar.subscribe"]);
    expect(cardIds("sidebar", "Sidebar")).toEqual(["sidebar.cards", "sidebar.views"]);
    expect(cardIds("agents", "Review limits")).toHaveLength(9);
  });

  it("names rows and cards in ids the page can use", () => {
    expect(rowDomId("appearance.zoom")).toBe("setting-appearance-zoom");
    expect(sectionId("History")).toBe("settings-history");
    expect(sectionId("AI providers")).toBe("settings-ai-providers");
  });
});

describe("searching Settings", () => {
  const ids = (query: string, desktop = false) => [...searchSettings(query, desktop).ids];

  it("finds a setting by its label", () => {
    expect(ids("interface size")).toContain("appearance.zoom");
    expect(ids("INTERFACE")).toContain("appearance.zoom");
    expect(ids("page width")).toEqual(["pages.pageWidth"]);
  });

  it("finds a setting by a word of its explanation", () => {
    // Only the explanation says "reduce-motion".
    expect(ids("reduce-motion")).toEqual(["appearance.motion"]);
    expect(ids("misspelled")).toEqual([]);
    expect(ids("spell checker")).toEqual(["pages.spellcheck"]);
  });

  it("finds a setting by a keyword it is known by", () => {
    const zoom = searchSettings("zoom", false);
    expect([...zoom.ids]).toEqual(["appearance.zoom"]);
    expect(zoom.byGroup.get("appearance")).toBe(1);
    expect(ids("magnify")).toEqual(["appearance.zoom"]);
    expect(ids("dark")).toContain("appearance.theme");
  });

  it("needs every word, in any order", () => {
    expect(ids("size interface")).toContain("appearance.zoom");
    expect(ids("interface nonsense")).toEqual([]);
    expect(ids("   ")).toEqual([]);
  });

  it("counts what it found in each group, and in all", () => {
    const found = searchSettings("calendar", false);
    // Every setting of the Calendar group has its group's name to be found by.
    for (const e of ENTRIES.filter((e) => e.group === "calendar" && !e.quiet && e.only !== "desktop")) expect(found.ids.has(e.id), e.id).toBe(true);
    expect(found.byGroup.get("calendar")).toBe(ENTRIES.filter((e) => e.group === "calendar" && e.only !== "desktop").length);
    // Others mention it too, such as where a page picked in the calendar opens.
    expect(found.ids.has("pages.peek")).toBe(true);
    expect([...found.byGroup.values()].reduce((a, b) => a + b, 0)).toBe(found.total);
    expect(found.total).toBe(found.ids.size);
  });

  it("finds the keyboard group, and the keys of the keychain, for 'key'", () => {
    const found = searchSettings("key", false);
    expect(found.byGroup.get("shortcuts")).toBe(2);
    expect(found.byGroup.get("ai")).toBeGreaterThan(0);
    expect(found.ids.has("shortcuts.editor")).toBe(true);
  });

  it("leaves out what the other app does not draw, and what is only there sometimes", () => {
    // Quick capture is in the desktop app only; "Search by meaning works in the desktop app" in the preview only.
    expect(ids("quick capture", false)).not.toContain("desktop.capture");
    expect(ids("quick capture", true)).toContain("desktop.capture");
    expect(ids("works in the desktop app", false)).toContain("search.unavailable");
    expect(ids("works in the desktop app", true)).not.toContain("search.unavailable");
    expect(ids("starter templates", false)).not.toContain("templates.missing");
    expect(ids("vectors", true)).not.toContain("search.vectors");
  });
});

describe("opening Settings by name", () => {
  it("takes a group's title, id or alias", () => {
    expect(settingsTarget("History and backup")).toEqual({ group: "history" });
    expect(settingsTarget("ai")).toEqual({ group: "ai" });
    expect(settingsTarget("Browser extension")).toEqual({ group: "extension" });
  });

  it("takes a path, with or without kasten: in front, and a row of that group", () => {
    expect(settingsTarget("settings/appearance")).toEqual({ group: "appearance" });
    expect(settingsTarget("kasten:settings/appearance/appearance.zoom")).toEqual({ group: "appearance", row: "appearance.zoom" });
    // A row of another group is not followed.
    expect(settingsTarget("settings/appearance/pages.font")).toEqual({ group: "appearance" });
    expect(settingsTarget("kasten:settings/ai")).toEqual({ group: "ai" });
  });

  it("takes an entry id on its own, and says no to what it does not know", () => {
    expect(settingsTarget("browser.webLinks")).toEqual({ group: "browser", row: "browser.webLinks" });
    expect(settingsTarget("settings/nowhere")).toBeNull();
    expect(settingsTarget("")).toBeNull();
    expect(settingsTarget("settings")).toBeNull();
  });
});

describe("the words of a search", () => {
  it("splits a query into lower-case words", () => {
    expect(wordsOf("  Interface   SIZE ")).toEqual(["interface", "size"]);
    expect(wordsOf("")).toEqual([]);
    expect(hasWords(["a", "b"], "Alpha beta")).toBe(true);
    expect(hasWords(["a", "x"], "Alpha beta")).toBe(false);
    expect(hasWords([], "anything")).toBe(false);
  });

  it("cuts a text where the words match, keeping every character", () => {
    const parts = pieces("Interface size and the other size", ["size"]);
    expect(parts.map((p) => p.text).join("")).toBe("Interface size and the other size");
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["size", "size"]);
    expect(pieces("Keyboard", ["key", "board"]).filter((p) => p.hit).map((p) => p.text)).toEqual(["Key", "board"]);
    expect(pieces("nothing", ["zzz"])).toEqual([{ text: "nothing", hit: false }]);
    expect(pieces("Text (size)", ["(size)"]).filter((p) => p.hit).map((p) => p.text)).toEqual(["(size)"]);
    expect(pieces("anything", [])).toEqual([{ text: "anything", hit: false }]);
  });
});
