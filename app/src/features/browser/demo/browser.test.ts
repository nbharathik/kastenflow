import { afterEach, describe, expect, it } from "vitest";

import { fakeClock } from "../../../demo/fake-clock";
import type { BrowserEvent } from "../types";
import { demoBrowser, demoPreview } from "./backend";
import { hostOf, pageFor, titleOf } from "./page";
import { DemoViews, LOAD_MS } from "./views";

const BOUNDS = { x: 100, y: 80, width: 640, height: 400 };

afterEach(() => {
  document.body.replaceChildren();
});

function make() {
  const clock = fakeClock();
  const views = new DemoViews(clock);
  const events: BrowserEvent[] = [];
  views.onEvent((e) => events.push(e));
  return { clock, views, events };
}

describe("the demo's canned page", () => {
  it("shows the same page for any address, with the address in it", () => {
    expect(hostOf("https://www.example.org/a/b?c=1")).toBe("example.org");
    expect(hostOf("not an address")).toBe("example.org");
    const page = pageFor("https://docs.example.net/guide?x=<1>");
    expect(page).toContain("<title>Notes that outlast the app · docs.example.net</title>");
    expect(page).toContain("https://docs.example.net/guide?x=&lt;1&gt;");
    expect(titleOf("https://a.test/")).toContain("a.test");
  });
});

describe("the demo's web views", () => {
  it("lays a frame over the tab where the bounds say, and tells the window a page loaded", async () => {
    const { views, clock, events } = make();
    expect(await views.open("tab-1", "https://news.example.com/story", BOUNDS)).toBe("https://news.example.com/story");
    const frame = document.querySelector<HTMLIFrameElement>("iframe[data-demo-view='tab-1']")!;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toContain("news.example.com");
    expect(frame.style.left).toBe("100px");
    expect(frame.style.width).toBe("640px");
    expect(events).toEqual([{ id: "tab-1", kind: "loading", loading: true, url: "https://news.example.com/story" }]);
    clock.advance(LOAD_MS);
    expect(events.slice(1)).toEqual([
      { id: "tab-1", kind: "title", title: "Notes that outlast the app · news.example.com", url: "https://news.example.com/story" },
      { id: "tab-1", kind: "loading", loading: false, url: "https://news.example.com/story" },
    ]);
  });

  it("moves, hides, shows and closes a view", async () => {
    const { views, events } = make();
    await views.open("tab-1", "https://a.test/", BOUNDS);
    await views.bounds("tab-1", { ...BOUNDS, x: 300 });
    const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
    expect(frame.style.left).toBe("300px");
    await views.hide("tab-1");
    expect(frame.style.display).toBe("none");
    await views.show("tab-1");
    expect(frame.style.display).toBe("");
    await views.close("tab-1");
    expect(document.querySelector("iframe")).toBeNull();
    expect(events.at(-1)).toEqual({ id: "tab-1", kind: "closed" });
    expect(views.count).toBe(0);
  });

  it("goes back and forward, and to a new address, in its own history", async () => {
    const { views } = make();
    await views.open("tab-1", "https://a.test/", BOUNDS);
    await views.nav("tab-1", { action: "url", url: "https://b.test/" });
    const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
    expect(frame.getAttribute("srcdoc")).toContain("b.test");
    await views.nav("tab-1", { action: "back" });
    expect(frame.getAttribute("srcdoc")).toContain("a.test");
    await views.nav("tab-1", { action: "forward" });
    expect(frame.getAttribute("srcdoc")).toContain("b.test");
  });

  it("does not load again when it is shown at the address it has", async () => {
    const { views, events } = make();
    await views.open("tab-1", "https://a.test/", BOUNDS);
    await views.hide("tab-1");
    await views.open("tab-1", "https://a.test/", BOUNDS);
    expect(events.filter((e) => e.kind === "loading" && e.loading)).toHaveLength(1);
  });
});

describe("the demo's browser backends", () => {
  it("share one switch with the plugin, and answer for every tab", async () => {
    const { views } = make();
    let on = false;
    const backend = demoBrowser(views, { get: () => on, set: (value) => (on = value) });
    expect(backend.available).toBe(true);
    expect(await backend.enabled()).toBe(false);
    expect(await backend.setEnabled(true)).toBe(true);
    expect(on).toBe(true);
    await expect(backend.capture("tab-1", "page")).rejects.toThrow("not part of the demo");
    const heard: BrowserEvent[] = [];
    await backend.onEvent((e) => heard.push(e));
    await backend.open("tab-2", "https://a.test/", BOUNDS);
    expect(heard[0]).toMatchObject({ id: "tab-2", kind: "loading" });
  });

  it("opens the link menu's preview as the one view called preview", async () => {
    const { views } = make();
    const preview = demoPreview(views);
    expect(preview.available).toBe(true);
    await preview.open("https://a.test/", BOUNDS);
    expect(document.querySelector("iframe[data-demo-view='preview']")).not.toBeNull();
    await preview.close();
    expect(views.count).toBe(0);
  });
});
