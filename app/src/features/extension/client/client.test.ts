// The browser extension's requests to Kasten: what is sent, to where, and what
// each way of going wrong is called. (The extension's code is in browser-extension/src.)

import { describe, expect, it } from "vitest";

import { Kasten, KastenError, baseUrl } from "../../../../../browser-extension/src/client";
import { kasten } from "./kit";

const TOKEN = "tok-43-characters-long-0123456789abcdefghi";

describe("the requests", () => {
  it("go to 127.0.0.1 on the port, and never carry cookies or a referrer", async () => {
    const fake = kasten();
    await new Kasten(7500, TOKEN, fake.send).targets();
    expect(fake.calls[0]!.url).toBe("http://127.0.0.1:7500/v1/targets");
    expect(baseUrl(7434)).toBe("http://127.0.0.1:7434");
  });

  it("pair with the code and a label, and no token yet", async () => {
    const fake = kasten();
    const paired = await new Kasten(7434, null, fake.send).pair(" abcd-2345 ", "Edge");
    expect(paired).toEqual({ token: TOKEN, id: "a1b2c3d4", vault: "Notes" });
    expect(fake.calls[0]).toMatchObject({ method: "POST", path: "/v1/pair", body: { code: "abcd-2345", label: "Edge" } });
    expect(fake.calls[0]!.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("list the places with the token and no body", async () => {
    const fake = kasten();
    const places = await new Kasten(7434, TOKEN, fake.send).targets();
    expect(places.projects.map((p) => p.id)).toEqual(["trip", "work"]);
    expect(fake.calls[0]).toMatchObject({ method: "GET", path: "/v1/targets", body: undefined });
    expect(fake.calls[0]!.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it("keep a capture with the token and the JSON as given", async () => {
    const fake = kasten();
    const saved = await new Kasten(7434, TOKEN, fake.send).capture({ url: "https://example.com/a", title: "A", text: "Words.", target: { kind: "project", project: "trip" }, tags: ["reading"] });
    expect(saved).toEqual({ ok: true, path: "inbox/saved.md", title: "A", place: "trip" });
    expect(fake.calls[0]).toMatchObject({ method: "POST", path: "/v1/capture", body: { url: "https://example.com/a", title: "A", text: "Words.", target: { kind: "project", project: "trip" }, tags: ["reading"] } });
    expect(fake.calls[0]!.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` });
  });

  it("ask the browser for no cookies, no cache and no referrer", async () => {
    let seen: RequestInit | undefined;
    await new Kasten(7434, TOKEN, (_url, init) => {
      seen = init;
      return Promise.resolve(new Response("{}"));
    }).targets();
    expect(seen).toMatchObject({ credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("what goes wrong", () => {
  const trouble = async (answer: Parameters<typeof kasten>[0]) => {
    const error = await new Kasten(7434, TOKEN, kasten(answer).send).targets().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(KastenError);
    return error as KastenError;
  };

  it("is a Kasten that is closed, or listening on another port", async () => {
    const error = await trouble(() => "closed");
    expect(error.trouble).toBe("closed");
    expect(error.message).toContain("127.0.0.1:7434");
    expect(error.message).toContain("Settings → Browser extension");
  });

  it("is named by what Kasten answered, in Kasten's own words", async () => {
    for (const [status, name] of [
      [401, "unpaired"],
      [403, "refused"],
      [503, "off"],
      [413, "too-big"],
      [429, "busy"],
      [400, "invalid"],
      [415, "invalid"],
      [422, "invalid"],
      [404, "invalid"],
      [500, "other"],
    ] as const) {
      const error = await trouble(() => ({ status, body: { error: `Said ${status}` } }));
      expect([error.trouble, error.message, error.status]).toEqual([name, `Said ${status}`, status]);
    }
  });

  it("is a page already saved when a 409 names its cards, and a plain refusal when it does not", async () => {
    const card = { path: "inbox/slip-box-basics.md", title: "Slip-box basics", captured: "2026-09-01" };
    const saved = await trouble(() => ({ status: 409, body: { error: "Already saved on 2026-09-01", existing: [card, { path: "inbox/slip-box-basics-2.md", title: "Slip-box basics", captured: null }] } }));
    expect([saved.trouble, saved.message, saved.status]).toEqual(["saved", "Already saved on 2026-09-01", 409]);
    expect(saved.existing).toEqual([card, { path: "inbox/slip-box-basics-2.md", title: "Slip-box basics", captured: null }]);
    // The 409 of a full list of paired browsers is not that.
    const full = await trouble(() => ({ status: 409, body: { error: "Eight browsers are paired" } }));
    expect([full.trouble, full.existing]).toEqual(["other", []]);
    // Cards it cannot read make it a plain refusal too.
    const odd = await trouble(() => ({ status: 409, body: { error: "Already saved", existing: [{ title: 3 }] } }));
    expect([odd.trouble, odd.existing]).toEqual(["other", []]);
  });

  it("keep a capture again on request, with the flag as given", async () => {
    const fake = kasten();
    await new Kasten(7434, TOKEN, fake.send).capture({ url: "https://example.com/a", again: true });
    expect(fake.calls[0]!.body).toEqual({ url: "https://example.com/a", again: true });
  });

  it("is said plainly when Kasten gave no reason, or an answer that is not Kasten's", async () => {
    const none = await trouble(() => ({ status: 403, body: {} }));
    expect(none.message).toBe("KastenFlow refused that (403).");
    const odd = await new Kasten(7434, TOKEN, () => Promise.resolve(new Response("<html>hello</html>", { status: 200 }))).targets().then(
      () => null,
      (e: unknown) => e as KastenError,
    );
    expect(odd?.trouble).toBe("other");
    const text = await new Kasten(7434, TOKEN, () => Promise.resolve(new Response("not json", { status: 502 }))).targets().then(
      () => null,
      (e: unknown) => e as KastenError,
    );
    expect(text?.trouble).toBe("other");
  });
});
