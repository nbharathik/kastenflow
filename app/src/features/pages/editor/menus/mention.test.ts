// Page links: the `[[` and `@` menus, the `]]` shortcut and the mention view.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import type { LinkProvider } from "../links";
import { isoDay, mentionQuery } from "./mention";

const pages = [
  { title: "Duplicate score for photos", icon: "💡" },
  { title: "Photo organiser roadmap", icon: "🗺️" },
];
let weekStart = 1;
const links: LinkProvider = {
  weekStart: () => weekStart,
  pages: () => pages,
  open: vi.fn(),
  create: vi.fn(),
  preview: vi.fn(async (title: string) => ({ title, icon: "🗺️", text: "Phase one: parse geometry." })),
};
const editor = useTestEditor({ links });
const menu = () => document.querySelector<HTMLElement>(".kasten-menu");
const keys = () => [...(menu()?.querySelectorAll<HTMLElement>(".kasten-menu-item") ?? [])].map((row) => row.dataset.key);

afterEach(() => {
  editor.press("Escape");
  vi.clearAllMocks();
});

describe("[[ links", () => {
  it("list pages as you type and link the pick", () => {
    editor.open("See\n").caret("See", true);
    editor.type(" [[road");
    expect(mentionQuery(editor.view.state)).toBe("road");
    expect(keys()).toEqual(["page:Photo organiser roadmap", "create"]);
    editor.press("Enter");
    expect(editor.save()).toBe("See [[Photo organiser roadmap]]\n");
  });

  it("create a page that does not exist yet", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" [[Reading list");
    editor.press("ArrowUp");
    editor.press("Enter");
    expect(links.create).toHaveBeenCalledWith("Reading list");
    expect(editor.save()).toBe("x [[Reading list]]\n");
  });

  it("turn a typed [[Title]] into a link", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" [[Anything]]");
    expect(editor.doc.firstChild?.lastChild?.type.name).toBe("wiki_link");
    expect(editor.save()).toBe("x [[Anything]]\n");
  });
});

describe("/page and /link", () => {
  it("name a new sub-page and link it", () => {
    editor.open("\n");
    editor.type("/page");
    editor.press("Enter");
    expect(keys()).toEqual([]);
    editor.type("Chapter one");
    expect(keys()).toEqual(["create"]);
    editor.press("Enter");
    expect(links.create).toHaveBeenCalledWith("Chapter one");
    expect(editor.save()).toBe("[[Chapter one]]\n");
    // A page block on its own line, and writing goes on below it.
    expect(editor.view.dom.querySelector(".kasten-mention")?.classList.contains("is-block")).toBe(true);
    editor.type("Next");
    expect(editor.save()).toBe("[[Chapter one]]\n\nNext\n");
  });

  it("keep a link typed with [[ inline, with a space to go on", () => {
    editor.open("\n");
    editor.type("[[dupl");
    editor.press("Enter");
    editor.type("is next");
    expect(editor.save()).toBe("[[Duplicate score for photos]] is next\n");
  });

  it("pick a page to link", () => {
    editor.open("\n");
    editor.type("/link");
    editor.press("Enter");
    editor.type("dupl");
    expect(keys()[0]).toBe("page:Duplicate score for photos");
    editor.press("Enter");
    expect(editor.save()).toBe("[[Duplicate score for photos]]\n");
  });
});

describe("@ mentions", () => {
  it("link today's journal day", () => {
    editor.open("Due\n").caret("Due", true);
    editor.type(" @");
    expect(keys()[0]).toBe(`day:${isoDay(new Date())}`);
    editor.press("Enter");
    expect(editor.save()).toBe(`Due [[${isoDay(new Date())}]]\n`);
  });

  it("find pages and exact dates", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" @2026-10-01");
    expect(keys()).toEqual(["day:2026-10-01"]);
    editor.press("Escape");
    editor.open("x\n").caret("x", true);
    editor.type(" @dupl");
    expect(keys()).toEqual(["page:Duplicate score for photos"]);
  });

  it("stay closed inside a word", () => {
    editor.open("mail\n").caret("mail", true);
    editor.type("@host");
    expect(mentionQuery(editor.view.state)).toBeNull();
  });

  it("offer only days that exist", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" @2026-13-45");
    expect(keys()).toEqual([]);
    editor.press("Escape");
    editor.open("x\n").caret("x", true);
    editor.type(" @2026-02-29");
    expect(keys()).toEqual([]);
    editor.press("Escape");
    editor.open("x\n").caret("x", true);
    editor.type(" @2024-02-29");
    expect(keys()).toEqual(["day:2024-02-29"]);
  });
});

describe("@ dates and times", () => {
  // Wednesday 7 October 2026, 10:30: only the clock is faked, the editor needs its timers.
  beforeEach(() => void vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 7, 10, 30) }));
  afterEach(() => void vi.useRealTimers());

  it("link a day with a time as `[[day]] time`", () => {
    editor.open("Standup\n").caret("Standup", true);
    editor.type(" @next fri 3pm");
    expect(keys()).toEqual(["day:2026-10-16 15:00"]);
    editor.press("Enter");
    expect(editor.save()).toBe("Standup [[2026-10-16]] 15:00\n");
  });

  it("put today's day link before a time typed alone", () => {
    editor.open("Call\n").caret("Call", true);
    editor.type(" @14:00");
    expect(keys()).toEqual(["day:2026-10-07 14:00"]);
    editor.press("Enter");
    expect(editor.save()).toBe("Call [[2026-10-07]] 14:00\n");
  });

  it("let writing go on after the time", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" @tomorrow 9am");
    editor.press("Enter");
    editor.type("review");
    expect(editor.save()).toBe("x [[2026-10-08]] 09:00 review\n");
  });

  it("read weekdays, and days without a time keep the plain link", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" @fri");
    expect(keys()).toEqual(["day:2026-10-09"]);
    editor.press("Enter");
    expect(editor.save()).toBe("x [[2026-10-09]]\n");
  });

  it("follow the day the week starts on", () => {
    weekStart = 0;
    editor.open("x\n").caret("x", true);
    editor.type(" @next week");
    expect(keys()).toEqual(["day:2026-10-11"]);
    weekStart = 1;
    editor.press("Escape");
  });

  it("work in a to-do", () => {
    editor.open("- [ ] Call Sam\n").caret("Call Sam", true);
    editor.type(" @friday");
    editor.press("Enter");
    expect(editor.save()).toBe("- [ ] Call Sam [[2026-10-09]]\n");
  });
});

describe("the mention view", () => {
  it("shows a link alone on its line as a page block, with a hint of the page", async () => {
    editor.open("[[Photo organiser roadmap]]\n\nSee [[Photo organiser roadmap]] inline.\n");
    const [block, inline] = [...editor.view.dom.querySelectorAll<HTMLElement>(".kasten-mention")];
    expect(block!.classList.contains("is-block")).toBe(true);
    expect(inline!.classList.contains("is-block")).toBe(false);
    await expect.poll(() => block!.querySelector(".kasten-page-block-hint")?.textContent).toBe("Phase one: parse geometry.");
    // The file keeps the plain link.
    expect(editor.save()).toBe("[[Photo organiser roadmap]]\n\nSee [[Photo organiser roadmap]] inline.\n");
  });

  it("shows the page's icon and title without brackets, and opens it", () => {
    editor.open("See [[Photo organiser roadmap]] and [[Missing page|a missing one]].\n");
    const mentions = [...editor.view.dom.querySelectorAll<HTMLElement>(".kasten-mention")];
    expect(mentions.map((m) => m.textContent)).toEqual(["🗺️Photo organiser roadmap", "a missing one"]);
    // A page with no icon of its own shows the page line icon.
    expect(mentions[1]!.querySelector(".kasten-mention-icon svg")).toBeTruthy();
    expect(mentions[1]!.classList.contains("is-missing")).toBe(true);
    mentions[0]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(links.open).toHaveBeenCalledWith("Photo organiser roadmap", "here");
    mentions[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(links.create).toHaveBeenCalledWith("Missing page", true);
  });
});

describe("mention previews", () => {
  it("show a page's first lines while hovering its link", async () => {
    editor.open("See [[Photo organiser roadmap]] here.\n");
    const mention = editor.view.dom.querySelector<HTMLElement>(".kasten-mention")!;
    mention.dispatchEvent(new MouseEvent("mouseenter"));
    await new Promise((resolve) => setTimeout(resolve, 520));
    const card = document.querySelector(".kasten-peek");
    expect(card?.textContent).toContain("Photo organiser roadmap");
    expect(card?.textContent).toContain("Phase one: parse geometry.");
    mention.dispatchEvent(new MouseEvent("mouseleave"));
    expect(document.querySelector(".kasten-peek")).toBeNull();
  });
});
