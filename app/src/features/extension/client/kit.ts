// Stand-ins for the browser and for Kasten, for testing the browser extension's
// own code (`browser-extension/src`): its storage, a Kasten that answers the
// three routes, and the page a tab shows.

import type { Fetch, PageRead, StorageArea, Tab } from "../../../../../browser-extension/src/env";
import type { Saved, Targets } from "../../../../../browser-extension/src/model";

export interface Memory extends StorageArea {
  data: Record<string, unknown>;
}

/** `chrome.storage.local`, in memory. */
export function memory(initial: Record<string, unknown> = {}): Memory {
  const data = { ...initial };
  return {
    data,
    get: (keys) => Promise.resolve(Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
    set: (items) => {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove: (keys) => {
      for (const key of keys) delete data[key];
      return Promise.resolve();
    },
  };
}

/** What Kasten was asked. */
export interface Call {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** What Kasten answers: a status and a JSON body, or nothing at all (it is closed). */
export type Answer = { status?: number; body?: unknown } | "closed";

export const PLACES: Targets = {
  vault: "Notes",
  inbox: { name: "Captures" },
  projects: [
    { id: "trip", name: "Trip" },
    { id: "work", name: "Work" },
  ],
  pages: [{ path: "library/reading.md", title: "Reading list" }],
};

/** A Kasten on 127.0.0.1 that answers the three routes as it should, unless `answer` says otherwise. */
export function kasten(answer: (call: Call) => Answer | undefined = () => undefined) {
  const calls: Call[] = [];
  const send: Fetch = (url, init) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const call: Call = { url, path: new URL(url).pathname, method: init.method ?? "GET", headers, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const said = answer(call) ?? usual(call);
    if (said === "closed") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(new Response(JSON.stringify(said.body ?? {}), { status: said.status ?? 200, headers: { "Content-Type": "application/json" } }));
  };
  return { send, calls };
}

function usual(call: Call): Answer {
  switch (call.path) {
    case "/v1/pair":
      return { body: { token: "tok-43-characters-long-0123456789abcdefghi", id: "a1b2c3d4", vault: "Notes" } };
    case "/v1/targets":
      return { body: PLACES };
    case "/v1/capture": {
      const request = call.body as { title?: string; target?: { kind: string; project?: string } };
      const place = request.target?.kind === "project" ? (request.target.project ?? "") : request.target?.kind === "page" ? "Reading list" : "Captures";
      return { body: { ok: true, path: "inbox/saved.md", title: request.title || "Saved", place } satisfies Saved };
    }
    default:
      return { status: 404, body: { error: "No such route" } };
  }
}

export const TAB: Tab = { id: 7, url: "https://example.com/guide/slip-box", title: "Slip-box basics" };

export const READ: PageRead = {
  title: "Slip-box basics",
  selectionHtml: "<p>One idea per note.</p>",
  selectionText: "One idea per note.",
  html: "<html><body><article><h1>Slip-box</h1><p>Body text.</p></article></body></html>",
  text: "Slip-box\n\nBody text.",
};
