// The code editor's state: files read, changes saved 500 ms after the last
// keystroke against the hash they were read with, the page's frame told to
// load again after each save, a file that changed on disk offered as a choice
// (never merged), and nothing lost on leaving.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushOpenPage } from "../../workspace/page/open-page";
import { FakeAuthor } from "./test-support/fake-author";
import { SAVE_DELAY_MS, useCodeFiles } from "./use-code-files";

const PAGE = "library/tracker.md";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wait = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

async function mount(author = new FakeAuthor()) {
  const saved = vi.fn();
  const view = renderHook(() => useCodeFiles(PAGE, author, saved));
  await wait();
  await wait();
  return { author, saved, view, hook: () => view.result.current };
}

describe("opening", () => {
  it("lists the files and opens index.html first", async () => {
    const { hook } = await mount();
    expect(hook().listing?.files.map((f) => f.path)).toEqual(["index.html", "app.js", "smart.yaml"]);
    expect(hook().current).toBe("index.html");
    expect(hook().files["index.html"]?.text).toBe("<h1>Hi</h1>");
  });

  it("says in a sentence when the folder cannot be read", async () => {
    const author = new FakeAuthor();
    author.failListing = "The folder is locked.";
    const { hook } = await mount(author);
    expect(hook().failed).toBe("The folder is locked.");
  });

  it("opens another file on request", async () => {
    const { hook, view } = await mount();
    act(() => hook().open("app.js"));
    await wait();
    expect(view.result.current.current).toBe("app.js");
    expect(view.result.current.files["app.js"]?.text).toBe("var a = 1;");
  });
});

describe("saving", () => {
  it("waits 500 ms after the last keystroke, then saves once against the hash it read", async () => {
    const { author, saved, hook } = await mount();
    const read = author.disk.get("index.html")!.hash;
    act(() => hook().edit("index.html", "<h1>A</h1>"));
    await wait(SAVE_DELAY_MS - 1);
    act(() => hook().edit("index.html", "<h1>AB</h1>"));
    await wait(SAVE_DELAY_MS - 1);
    expect(author.writes).toEqual([]);
    expect(hook().unsaved).toBe(true);
    await wait(1);
    expect(author.writes).toEqual([{ path: "index.html", text: "<h1>AB</h1>", base: read }]);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(hook().unsaved).toBe(false);
    expect(hook().files["index.html"]?.hash).toBe(author.disk.get("index.html")!.hash);
  });

  it("writes the next change against the hash the last save gave", async () => {
    const { author, hook } = await mount();
    act(() => hook().edit("index.html", "one"));
    await wait(SAVE_DELAY_MS);
    const first = author.disk.get("index.html")!.hash;
    act(() => hook().edit("index.html", "two"));
    await wait(SAVE_DELAY_MS);
    expect(author.writes.map((w) => w.base)).toEqual(["h1", first]);
    expect(author.disk.get("index.html")!.text).toBe("two");
  });

  it("saves at once when asked (Ctrl+S) and does not save an unchanged file", async () => {
    const { author, hook } = await mount();
    act(() => hook().edit("index.html", "x"));
    await act(async () => void (await hook().save("index.html")));
    expect(author.writes).toHaveLength(1);
    await act(async () => void (await hook().save("index.html")));
    await wait(SAVE_DELAY_MS * 2);
    expect(author.writes).toHaveLength(1);
  });

  it("keeps typing that happens while a save is on its way, and saves it next", async () => {
    const { author, hook, saved } = await mount();
    let release: () => void = () => {};
    const real = author.write.bind(author);
    author.write = (...args) => new Promise((resolve, reject) => (release = () => real(...args).then(resolve, reject)));
    act(() => hook().edit("index.html", "first"));
    await wait(SAVE_DELAY_MS);
    act(() => hook().edit("index.html", "first and more"));
    // The first save lands; the app answers every later write as usual.
    author.write = real;
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    await wait(SAVE_DELAY_MS);
    expect(author.disk.get("index.html")!.text).toBe("first and more");
    expect(saved.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(hook().unsaved).toBe(false);
  });

  it("saves what is waiting when the editor is left", async () => {
    const { author, hook, view } = await mount();
    act(() => hook().edit("index.html", "last words"));
    view.unmount();
    await wait();
    expect(author.disk.get("index.html")!.text).toBe("last words");
  });

  it("saves what was typed while a save was on its way even when the editor is left meanwhile", async () => {
    const { author, hook, view } = await mount();
    let release: () => void = () => {};
    const real = author.write.bind(author);
    author.write = (...args) => new Promise((resolve, reject) => (release = () => real(...args).then(resolve, reject)));
    act(() => hook().edit("index.html", "first"));
    await wait(SAVE_DELAY_MS);
    act(() => hook().edit("index.html", "first and the last words"));
    author.write = real;
    view.unmount();
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    await wait(SAVE_DELAY_MS);
    expect(author.disk.get("index.html")!.text).toBe("first and the last words");
  });

  it("saves what is waiting when the window is closing, and when the app writes its open pages", async () => {
    const { author, hook } = await mount();
    act(() => hook().edit("index.html", "closing"));
    act(() => void window.dispatchEvent(new Event("pagehide")));
    await wait();
    expect(author.disk.get("index.html")!.text).toBe("closing");
    act(() => hook().open("app.js"));
    await wait();
    act(() => hook().edit("app.js", "var b = 2;"));
    await act(async () => void (await flushOpenPage()));
    expect(author.disk.get("app.js")!.text).toBe("var b = 2;");
  });

  it("gives back typing that could not be saved when the editor was left, and never writes it over a newer file", async () => {
    const first = await mount();
    first.author.changeOnDisk("index.html", "<h1>from outside</h1>");
    act(() => first.hook().edit("index.html", "<h1>my long work</h1>"));
    await wait(SAVE_DELAY_MS);
    expect(first.hook().files["index.html"]?.conflict).not.toBeNull();
    first.view.unmount();
    await wait();
    // Opened again: the typing is back, saved over the hash it was typed on, so the newer file is a conflict.
    const again = await mount(first.author);
    const file = again.hook().files["index.html"]!;
    expect(file.text).toBe("<h1>my long work</h1>");
    expect(file.dirty).toBe(true);
    expect(file.problem).toMatch(/back here/);
    await act(async () => void (await again.hook().save("index.html")));
    expect(first.author.disk.get("index.html")!.text).toBe("<h1>from outside</h1>");
    expect(again.hook().files["index.html"]?.conflict?.disk).toBe("<h1>from outside</h1>");
    again.view.unmount();
    await wait();
  });

  it("says why a save did not work, keeps the text, and tries again on request", async () => {
    const { author, hook } = await mount();
    author.failNext = "That file is too large.";
    act(() => hook().edit("index.html", "big"));
    await wait(SAVE_DELAY_MS);
    expect(hook().files["index.html"]?.problem).toBe("That file is too large.");
    expect(hook().files["index.html"]?.dirty).toBe(true);
    await act(async () => void (await hook().save("index.html")));
    expect(hook().files["index.html"]?.problem).toBeNull();
    expect(author.disk.get("index.html")!.text).toBe("big");
  });
});

describe("a file that changed on disk", () => {
  async function conflicted() {
    const m = await mount();
    m.author.changeOnDisk("index.html", "<h1>from outside</h1>");
    act(() => m.hook().edit("index.html", "<h1>mine</h1>"));
    await wait(SAVE_DELAY_MS);
    return m;
  }

  it("is not written over, and not merged: the editor offers a choice", async () => {
    const { author, hook, saved } = await conflicted();
    expect(author.disk.get("index.html")!.text).toBe("<h1>from outside</h1>");
    expect(hook().files["index.html"]?.conflict?.disk).toBe("<h1>from outside</h1>");
    expect(hook().files["index.html"]?.text).toBe("<h1>mine</h1>");
    expect(saved).not.toHaveBeenCalled();
    // Typing on does not try again until the choice is made.
    act(() => hook().edit("index.html", "<h1>mine, more</h1>"));
    await wait(SAVE_DELAY_MS);
    expect(author.writes).toHaveLength(1);
  });

  it("Keep mine writes the editor's text over the file on disk", async () => {
    const { author, hook, saved } = await conflicted();
    await act(async () => void (await hook().keepMine("index.html")));
    expect(author.disk.get("index.html")!.text).toBe("<h1>mine</h1>");
    expect(hook().files["index.html"]?.conflict).toBeNull();
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("Use the file on disk takes its text, and the editor is told to load it", async () => {
    const { author, hook, saved } = await conflicted();
    const before = hook().files["index.html"]!.revision;
    act(() => hook().takeDisk("index.html"));
    const file = hook().files["index.html"]!;
    expect(file.text).toBe("<h1>from outside</h1>");
    expect(file.dirty).toBe(false);
    expect(file.conflict).toBeNull();
    expect(file.revision).toBe(before + 1);
    expect(author.writes).toHaveLength(1);
    expect(saved).toHaveBeenCalledTimes(1);
  });
});

describe("a file that was taken away on disk", () => {
  it("is a choice too: Keep mine makes it again, and nothing on disk is offered instead", async () => {
    const m = await mount();
    m.author.removeOnDisk("index.html");
    act(() => m.hook().edit("index.html", "<h1>mine</h1>"));
    await wait(SAVE_DELAY_MS);
    const file = m.hook().files["index.html"]!;
    expect(file.conflict).toEqual({ disk: "", diskHash: "", gone: true });
    expect(file.problem).toBeNull();
    expect(m.author.disk.has("index.html")).toBe(false);
    await act(async () => void (await m.hook().keepMine("index.html")));
    expect(m.author.disk.get("index.html")!.text).toBe("<h1>mine</h1>");
    expect(m.hook().files["index.html"]?.conflict).toBeNull();
  });
});

describe("new and removed files", () => {
  it("makes a file with a name, opens it, and tells the frame", async () => {
    const { author, hook, saved } = await mount();
    let said: string | null = "x";
    await act(async () => void (said = await hook().create("style.css")));
    expect(said).toBeNull();
    expect(author.writes.at(-1)).toEqual({ path: "style.css", text: "", base: "" });
    expect(hook().current).toBe("style.css");
    expect(hook().listing?.files.map((f) => f.path)).toContain("style.css");
    expect(saved).toHaveBeenCalled();
  });

  it("answers a sentence for an empty name and for a name that is taken", async () => {
    const { hook } = await mount();
    let said: string | null = null;
    await act(async () => void (said = await hook().create("  ")));
    expect(said).toMatch(/name/);
    await act(async () => void (said = await hook().create("app.js")));
    expect(said).toMatch(/already there/);
  });

  it("takes a file out to the trash and closes it", async () => {
    const { author, hook } = await mount();
    act(() => hook().open("app.js"));
    await wait();
    await act(async () => void (await hook().remove("app.js")));
    expect(author.removed).toEqual(["app.js"]);
    expect(hook().files["app.js"]).toBeUndefined();
    expect(hook().listing?.files.map((f) => f.path)).not.toContain("app.js");
  });
});
