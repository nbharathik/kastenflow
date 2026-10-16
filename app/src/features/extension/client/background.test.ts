// The right-click menu: a click sends what was clicked to where the last capture
// went, and says how it went on the toolbar button and, once, in the popup.

import { describe, expect, it } from "vitest";

import { LAST_RESULT, makeMenus, onMenuClick, type BackgroundEnv } from "../../../../../browser-extension/src/background";
import type { PageRead } from "../../../../../browser-extension/src/env";
import { READ, TAB, kasten, memory, type Answer, type Call } from "./kit";

const TOKEN = "tok-43-characters-long-0123456789abcdefghi";

function setup(stored: Record<string, unknown> = { token: TOKEN }, answer?: (call: Call) => Answer | undefined, page: PageRead | null = READ) {
  const storage = memory(stored);
  const fake = kasten(answer);
  const badges: [string, boolean][] = [];
  const timers: { then: () => void; ms: number }[] = [];
  const menus: { id: string; title: string; contexts: readonly string[] }[] = [];
  const cleared: number[] = [];
  const env: BackgroundEnv = {
    storage,
    read: () => Promise.resolve(page),
    send: fake.send,
    badge: (text, ok) => badges.push([text, ok]),
    addMenu: (item) => menus.push(item),
    clearMenus: () => {
      cleared.push(menus.length);
      menus.length = 0;
      return Promise.resolve();
    },
    later: (then, ms) => timers.push({ then, ms }),
  };
  return { env, storage, fake, badges, timers, menus, cleared };
}

const selection = { menuItemId: "kasten-selection", pageUrl: TAB.url, selectionText: "One idea per note." };
const lastResult = (storage: { data: Record<string, unknown> }) => storage.data[LAST_RESULT] as { ok: boolean; text: string };

describe("the menu", () => {
  it("is made afresh each time: the old one cleared, then page, selection, link and picture", async () => {
    const { env, menus, cleared } = setup();
    await makeMenus(env);
    await makeMenus(env);
    expect(cleared).toEqual([0, 4]);
    expect(menus.map((m) => m.id).sort()).toEqual(["kasten-image", "kasten-link", "kasten-page", "kasten-selection"]);
  });
});

describe("a click on the menu", () => {
  it("sends the selection to where the last capture went, and ticks the button, then clears it", async () => {
    const { env, fake, storage, badges, timers } = setup({ token: TOKEN, lastTarget: { kind: "project", project: "trip" } });
    await onMenuClick(env, selection, TAB);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ path: "/v1/capture", body: { url: TAB.url, title: "Slip-box basics", html: "<p>One idea per note.</p>", target: { kind: "project", project: "trip" } } });
    expect(fake.calls[0]!.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(badges).toEqual([["✓", true]]);
    expect(timers.map((t) => t.ms)).toEqual([4000]);
    timers[0]!.then();
    expect(badges.at(-1)).toEqual(["", true]);
    expect(lastResult(storage)).toMatchObject({ ok: true, text: "Sent to trip: Slip-box basics" });
  });

  it("goes to the inbox when nothing was chosen before", async () => {
    const { env, fake } = setup();
    await onMenuClick(env, { menuItemId: "kasten-page", pageUrl: TAB.url }, TAB);
    expect(fake.calls[0]!.body).toMatchObject({ url: TAB.url, html: READ.html, target: { kind: "inbox" } });
  });

  it("asks to pair when this browser is not paired, and sends nothing", async () => {
    const { env, fake, badges, storage } = setup({});
    await onMenuClick(env, selection, TAB);
    expect(fake.calls).toEqual([]);
    expect(badges).toEqual([["!", false]]);
    expect(lastResult(storage)).toMatchObject({ ok: false });
    expect(lastResult(storage).text).toContain("not paired");
  });

  it("forgets a token Kasten does not know, and says so", async () => {
    const { env, storage, badges } = setup({ token: TOKEN, vault: "Notes" }, () => ({ status: 401, body: { error: "This extension is not paired, or its pairing was revoked." } }));
    await onMenuClick(env, selection, TAB);
    expect(storage.data["token"]).toBeUndefined();
    expect(storage.data["vault"]).toBeUndefined();
    expect(badges[0]).toEqual(["!", false]);
    expect(lastResult(storage).text).toContain("revoked");
  });

  it("keeps the pairing when Kasten is closed, and says where it looked", async () => {
    const { env, storage, badges } = setup({ token: TOKEN, port: 7500 }, () => "closed");
    await onMenuClick(env, selection, TAB);
    expect(storage.data["token"]).toBe(TOKEN);
    expect(badges[0]).toEqual(["!", false]);
    expect(lastResult(storage).text).toContain("127.0.0.1:7500");
  });

  it("says why Kasten refused a capture, with what it said", async () => {
    const { env, storage } = setup({ token: TOKEN }, () => ({ status: 422, body: { error: "That address cannot be kept: only web pages (http or https) are captured" } }));
    await onMenuClick(env, selection, TAB);
    expect(lastResult(storage)).toMatchObject({ ok: false, text: "That address cannot be kept: only web pages (http or https) are captured" });
  });

  it("says a page is saved already, and that the popup can keep another snapshot", async () => {
    const card = { path: "inbox/a.md", title: "Slip-box basics", captured: "2026-09-01" };
    const { env, storage, badges, fake } = setup({ token: TOKEN }, () => ({ status: 409, body: { error: "Already saved on 2026-09-01", existing: [card] } }));
    await onMenuClick(env, selection, TAB);
    expect(badges[0]).toEqual(["!", false]);
    expect(lastResult(storage).text).toBe("Already saved on 2026-09-01. Nothing was sent: open the extension to save another snapshot.");
    // The pairing stays, and the request did not ask for a snapshot.
    expect(storage.data["token"]).toBe(TOKEN);
    expect(fake.calls[0]!.body).not.toHaveProperty("again");
  });

  it("sends nothing from a page it may not send, and says so", async () => {
    const { env, fake, storage } = setup();
    await onMenuClick(env, { menuItemId: "kasten-page", pageUrl: "chrome://extensions" }, { id: 1, url: "chrome://extensions" });
    expect(fake.calls).toEqual([]);
    expect(lastResult(storage).text).toContain("Only web pages");
  });

  it("notes a page that was cut to fit", async () => {
    const huge: PageRead = { ...READ, html: `<p>${"x ".repeat(1_500_000)}</p>`, text: "long line\n".repeat(300_000) };
    const { env, storage, fake } = setup({ token: TOKEN }, undefined, huge);
    await onMenuClick(env, { menuItemId: "kasten-page", pageUrl: TAB.url }, TAB);
    expect(fake.calls[0]!.body).toHaveProperty("text");
    expect(fake.calls[0]!.body).not.toHaveProperty("html");
    expect(lastResult(storage).text).toContain("only the start of its text went");
  });
});
