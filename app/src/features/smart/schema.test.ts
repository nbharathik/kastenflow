// The checks every message from a frame goes through, and the sandbox the
// frame is made with.

import { describe, expect, it } from "vitest";

import { checkMessage, isOwnCall, SMART_SANDBOX } from "./schema";
import { frameBase, frameUrl } from "./urls";

describe("the sandbox", () => {
  it("is scripts only", () => {
    expect(SMART_SANDBOX).toBe("allow-scripts");
  });
});

describe("a message from a frame", () => {
  it("is rebuilt from the fields it may have", () => {
    const checked = checkMessage({ id: 3, kind: "read", args: { id: "01ABC", extra: 1 }, more: true });
    expect(checked).toEqual({ ok: true, request: { id: 3, kind: "read", args: { id: "01ABC" } } });
  });

  it("is refused with its number when it has one, and with none when it has none", () => {
    expect(checkMessage({ id: 4, kind: "nope" })).toMatchObject({ ok: false, id: 4, error: { code: "bad_request" } });
    expect(checkMessage({ kind: "theme" })).toMatchObject({ ok: false, id: null });
    expect(checkMessage("theme")).toMatchObject({ ok: false, id: null });
    expect(checkMessage(null)).toMatchObject({ ok: false, id: null });
  });

  it("tells the calls the window answers from those that go to the app", () => {
    const own = ["watch", "unwatch", "theme", "resize", "log", "report"];
    for (const kind of own) expect(isOwnCall({ kind } as never), kind).toBe(true);
    for (const kind of ["query", "list", "read", "search", "journal", "project", "tasks", "board", "open", "update", "addTags", "createNote", "append", "toggleTodo"]) {
      expect(isOwnCall({ kind } as never), kind).toBe(false);
    }
  });
});

describe("the frame's address", () => {
  const SECRET = "0123456789abcdef".repeat(4);

  it("is the scheme's, the frame's secret, the page's id and a path whose every part is encoded alone", () => {
    expect(frameBase()).toMatch(/^(smart:\/\/localhost|http:\/\/smart\.localhost)$/);
    expect(frameUrl(SECRET, "01ABC")).toBe(`${frameBase()}/${SECRET}/01ABC/index.html`);
    expect(frameUrl(SECRET, "01ABC", "data/venues.json")).toBe(`${frameBase()}/${SECRET}/01ABC/data/venues.json`);
    expect(frameUrl(SECRET, "a b/c", "x y/z%.html")).toBe(`${frameBase()}/${SECRET}/a%20b%2Fc/x%20y/z%25.html`);
  });

  it("keeps the secret as the first part of the path, so every relative address inside the page keeps it", () => {
    const url = new URL(frameUrl(SECRET, "01ABC", "views/overview.html").replace(/^smart:/, "http:"));
    expect(url.pathname.split("/")[1]).toBe(SECRET);
    // A relative address and a one that climbs to the page's top stay inside the frame's own prefix.
    expect(new URL("app.js", url).pathname).toBe(`/${SECRET}/01ABC/views/app.js`);
    expect(new URL("../app.js", url).pathname).toBe(`/${SECRET}/01ABC/app.js`);
  });
});
