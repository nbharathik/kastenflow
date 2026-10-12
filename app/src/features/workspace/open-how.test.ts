import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { howFromPage, linkOpens, opensPrecedence, pageOpens } from "./open-how";
import { OPENS, isOpens } from "./opens";
import { registerPage } from "./page/open-page";
import { usePageLayouts } from "./page/page-layout";
import type { PageSession } from "./page/page-session";
import { usePrefs } from "./prefs";

describe("which way a plain click opens", () => {
  it("lets a peek or the stack choose first, then the page's own `opens`, then Settings, then here", () => {
    // Nothing asks, nothing chosen: here.
    expect(opensPrecedence(undefined, null, "here")).toBe("here");
    // Settings' default.
    expect(opensPrecedence(undefined, null, "right")).toBe("right");
    // The page's own key beats Settings, either way round.
    expect(opensPrecedence(undefined, "tab", "right")).toBe("tab");
    expect(opensPrecedence(undefined, "here", "right")).toBe("here");
    // A peek's or the stack's own way beats both.
    expect(opensPrecedence("peek", "tab", "right")).toBe("peek");
    expect(opensPrecedence("tab", "right", "stack")).toBe("tab");
    // "here" is no ask: the page's key and Settings still apply.
    expect(opensPrecedence("here", "stack", "right")).toBe("stack");
  });

  it("knows the six values and nothing else", () => {
    expect([...OPENS]).toEqual(["here", "tab", "right", "peek-side", "peek-center", "stack"]);
    for (const value of OPENS) expect(isOpens(value)).toBe(true);
    for (const value of ["split", "peek", "", "Right", null, undefined, 3]) expect(isOpens(value)).toBe(false);
  });
});

describe("a page's `opens` and Settings, as clicks meet them", () => {
  const session = { path: "library/a.md" } as PageSession;
  let forget = () => {};

  beforeEach(() => {
    usePrefs.setState({ pageLinksOpen: "here" });
    usePageLayouts.setState({ of: new Map() });
  });
  afterEach(() => forget());

  const open = (layout: Record<string, string>) => {
    forget = registerPage(session, () => {}, () => {});
    usePageLayouts.setState({ of: new Map([[session, layout as never]]) });
  };

  it("follows Settings where the page says nothing", () => {
    open({});
    expect(pageOpens("library/a.md")).toBeNull();
    expect(linkOpens("library/a.md")).toBe("here");
    usePrefs.setState({ pageLinksOpen: "peek-side" });
    expect(linkOpens("library/a.md")).toBe("peek-side");
    // The sidebar has no page: Settings alone.
    expect(linkOpens()).toBe("peek-side");
  });

  it("follows the page's key over Settings", () => {
    open({ opens: "right" });
    usePrefs.setState({ pageLinksOpen: "tab" });
    expect(pageOpens("library/a.md")).toBe("right");
    expect(linkOpens("library/a.md")).toBe("right");
    // Another page, or none open, does not borrow it.
    expect(linkOpens("library/b.md")).toBe("tab");
    expect(linkOpens()).toBe("tab");
  });

  it("ignores a value it does not know and falls back to Settings", () => {
    open({ opens: "sideways" });
    usePrefs.setState({ pageLinksOpen: "stack" });
    expect(pageOpens("library/a.md")).toBeNull();
    expect(linkOpens("library/a.md")).toBe("stack");
  });

  it("keeps the keys' own ways, whatever the page or Settings say", () => {
    open({ opens: "right" });
    usePrefs.setState({ pageLinksOpen: "peek-center" });
    expect(howFromPage({}, "library/a.md")).toBe("right");
    expect(howFromPage({ ctrlKey: true }, "library/a.md")).toBe("tab");
    expect(howFromPage({ shiftKey: true }, "library/a.md")).toBe("stack");
    expect(howFromPage({ altKey: true }, "library/a.md")).toBe("split");
    expect(howFromPage({ ctrlKey: true, altKey: true }, "library/a.md")).toBe("right");
    expect(howFromPage({ button: 1 }, "library/a.md")).toBe("tab");
    expect(howFromPage({})).toBe("peek-center");
  });
});
