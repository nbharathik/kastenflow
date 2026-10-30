// Making smart pages: from a starter (in the project the person is in, else
// the library), turning an open page into one without touching its text, going
// back, keeping one as a template, saving a copy, and showing one full screen.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../../lib/store";
import { usePageLayouts } from "../../workspace/page/page-layout";
import { useWorkspace } from "../../workspace/store";
import { exportSmartHtml, newSmartPage, presentingSmart, saveSmartTemplate, togglePresentSmart, turnIntoSmartPage } from "./flows";
import { forgetSnapshot, record, recorderFor } from "./snapshot";
import { FakeAuthor } from "./test-support/fake-author";
import { EXPORT_NEEDS_VIEW } from "./words";

const mocks = vi.hoisted(() => ({ session: null as null | { editHeader: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> }, undo: vi.fn(), fill: vi.fn() }));

vi.mock("../../workspace/page/open-page", () => ({ pageFor: () => mocks.session }));
vi.mock("../../workspace/reload", () => ({ reloadLists: vi.fn(async () => {}) }));
vi.mock("../../../lib/fullscreen", () => ({
  fillScreen: async (onLeft: () => void) => {
    mocks.fill(onLeft);
    return mocks.undo;
  },
}));

const toasts: string[] = [];
const opened: string[] = [];

beforeEach(() => {
  toasts.length = 0;
  opened.length = 0;
  mocks.undo.mockClear();
  mocks.fill.mockClear();
  mocks.session = { editHeader: vi.fn(), flush: vi.fn(async () => {}) };
  useWorkspace.setState({ toast: (text: string) => void toasts.push(text), openPath: (path: string) => void opened.push(path) } as never);
  useWorkspace.setState({ place: { view: "home" } } as never);
  usePageLayouts.setState({ of: new Map() });
  forgetSnapshot();
});
afterEach(() => {
  if (presentingSmart()) togglePresentSmart();
});

describe("a new smart page", () => {
  it("is made from the starter and opened", async () => {
    const author = new FakeAuthor();
    const made = await newSmartPage("dashboard", author);
    expect(made?.page).toBe("library/dashboard.md");
    expect(author.made).toEqual([{ starter: "dashboard", project: null }]);
    expect(opened).toEqual(["library/dashboard.md"]);
  });

  it("goes to the project that is asked for", async () => {
    const author = new FakeAuthor();
    await newSmartPage("tracker", author, "trip");
    expect(author.made).toEqual([{ starter: "tracker", project: "trip" }]);
  });

  it("falls back to the library when the project is not one", async () => {
    const author = new FakeAuthor();
    const real = author.newPage.bind(author);
    author.newPage = async (starter, project) => {
      if (project) throw new Error("There is no project there");
      return real(starter, project);
    };
    await newSmartPage("map", author, "not-a-project");
    expect(author.made).toEqual([{ starter: "map", project: null }]);
    expect(toasts).toEqual([]);
  });

  it("says in a sentence when it could not be made, and opens nothing", async () => {
    const author = new FakeAuthor();
    author.newPage = async () => {
      throw new Error("The vault is read-only.");
    };
    expect(await newSmartPage("map", author)).toBeNull();
    expect(toasts).toEqual(["The page could not be made: The vault is read-only."]);
    expect(opened).toEqual([]);
  });
});

describe("turning a page into a smart page", () => {
  it("sets the layout through the open page, lets it save, then writes the folder", async () => {
    const author = new FakeAuthor();
    const order: string[] = [];
    mocks.session!.editHeader.mockImplementation(() => void order.push("layout"));
    mocks.session!.flush.mockImplementation(async () => void order.push("saved"));
    const turn = author.turnInto.bind(author);
    author.turnInto = async (page, starter) => {
      order.push("folder");
      return turn(page, starter);
    };
    expect(await turnIntoSmartPage("library/a.md", "gallery", author)).toBe(true);
    expect(order).toEqual(["layout", "saved", "folder"]);
    expect(mocks.session!.editHeader).toHaveBeenCalledWith("layout", "smart");
    expect(author.turned).toEqual([{ page: "library/a.md", starter: "gallery" }]);
  });

  it("takes the layout back and says why when the folder could not be made", async () => {
    const author = new FakeAuthor();
    author.turnInto = async () => {
      throw new Error("index.html is too large");
    };
    expect(await turnIntoSmartPage("library/a.md", "gallery", author)).toBe(false);
    expect(mocks.session!.editHeader).toHaveBeenLastCalledWith("layout", null);
    expect(toasts[0]).toBe("The page could not be turned into a smart page: index.html is too large");
  });

  it("works for a page that is not open too", async () => {
    mocks.session = null;
    const author = new FakeAuthor();
    expect(await turnIntoSmartPage("library/a.md", "tracker", author)).toBe(true);
    expect(author.turned).toHaveLength(1);
  });
});

describe("a template of the person's own", () => {
  it("is kept under the page's name and the person is told where to find it", async () => {
    const author = new FakeAuthor();
    expect(await saveSmartTemplate("library/a.md", "Reading list", author)).toBe(true);
    expect(author.templates).toEqual([{ page: "library/a.md", name: "Reading list" }]);
    expect(toasts[0]).toBe("Kept as “Reading list”. It is under Your templates when you start a new smart page.");
  });

  it("says why it could not be kept", async () => {
    const author = new FakeAuthor();
    author.saveTemplate = async () => {
      throw new Error("Give the template a name with letters or digits in it");
    };
    expect(await saveSmartTemplate("library/a.md", "!!!", author)).toBe(false);
    expect(toasts[0]).toContain("Give the template a name");
  });
});

describe("saving a copy as an HTML file", () => {
  const files = { "index.html": '<html><head><script src="app.js"></script></head><body><p id="x">hi</p></body></html>', "app.js": "document.title = 'ok';" };

  it("asks the person to show the page first when its frame has not been showing", async () => {
    const save = vi.fn();
    expect(await exportSmartHtml("library/a.md", "A", { backend: new FakeAuthor(files), save })).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(toasts).toEqual([EXPORT_NEEDS_VIEW]);
  });

  it("saves one file named after the page, with the data of the moment inside", async () => {
    recorderFor("library/a.md");
    record("library/a.md", "query", { tag: "t" }, [{ id: "n1", title: "A note" }]);
    const saved: { name: string; text: string; type: string }[] = [];
    const where = await exportSmartHtml("library/a.md", "My page: v2", {
      backend: new FakeAuthor(files),
      today: () => "2026-10-23",
      save: async (name, bytes, type) => {
        saved.push({ name, text: new TextDecoder().decode(bytes), type });
        return `Downloads/${name}`;
      },
    });
    expect(where).toBe("Downloads/My-page-v2.html");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.type).toBe("text/html");
    expect(saved[0]!.text).toContain("A note");
    expect(saved[0]!.text).toContain("document.title = 'ok';");
    expect(saved[0]!.text).not.toMatch(/postMessage/);
    expect(toasts[0]).toContain("cannot change anything");
  });

  it("says what it could not put inside", async () => {
    recorderFor("library/b.md");
    const author = new FakeAuthor({ "index.html": '<html><body><img src="nope.png"></body></html>' });
    await exportSmartHtml("library/b.md", "B", { backend: author, save: async () => "x" });
    expect(toasts[0]).toContain("Left out: nope.png");
  });

  it("says why it could not be saved", async () => {
    recorderFor("library/c.md");
    await exportSmartHtml("library/c.md", "C", {
      backend: new FakeAuthor(files),
      save: async () => {
        throw new Error("The disk is full.");
      },
    });
    expect(toasts[0]).toBe("The copy could not be saved: The disk is full.");
  });
});

describe("showing a smart page full screen", () => {
  beforeEach(() => useShell.setState({ focusMode: false } as never));

  it("takes focus mode and the screen, and gives both back", async () => {
    togglePresentSmart();
    expect(useShell.getState().focusMode).toBe(true);
    expect(presentingSmart()).toBe(true);
    await vi.waitFor(() => expect(mocks.fill).toHaveBeenCalledTimes(1));
    togglePresentSmart();
    expect(useShell.getState().focusMode).toBe(false);
    expect(presentingSmart()).toBe(false);
    await vi.waitFor(() => expect(mocks.undo).toHaveBeenCalledTimes(1));
  });

  it("leaves when focus mode is left another way (Escape)", async () => {
    togglePresentSmart();
    await vi.waitFor(() => expect(mocks.fill).toHaveBeenCalled());
    useShell.getState().toggleFocus();
    expect(presentingSmart()).toBe(false);
    await vi.waitFor(() => expect(mocks.undo).toHaveBeenCalled());
  });
});
