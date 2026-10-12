// The extension's popup, in a page of its own: pairing with the code Kasten's
// Settings shows, then sending the selection, the page or the link, where the
// person picks, with tags; and every way Kasten may not be there.

import { fireEvent, waitFor, within } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LAST_RESULT } from "../../../../../browser-extension/src/background";
import type { PageRead, Tab } from "../../../../../browser-extension/src/env";
import { startPopup, type PopupEnv } from "../../../../../browser-extension/src/popup";
import { READ, TAB, kasten, memory, type Answer, type Call } from "./kit";

const TOKEN = "tok-43-characters-long-0123456789abcdefghi";
let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("main");
  document.body.append(root);
});

afterEach(() => {
  root.remove();
});

function open(stored: Record<string, unknown> = { token: TOKEN, vault: "Notes" }, answer?: (call: Call) => Answer | undefined, options: { tab?: Tab; page?: PageRead | null } = {}) {
  const storage = memory(stored);
  const fake = kasten(answer);
  const close = vi.fn();
  const clearBadge = vi.fn();
  const env: PopupEnv = {
    storage,
    activeTab: () => Promise.resolve("tab" in options ? options.tab : TAB),
    read: () => Promise.resolve("page" in options ? (options.page ?? null) : READ),
    send: fake.send,
    clearBadge,
    close,
    browser: "Edge",
  };
  const started = startPopup(env, root);
  return { storage, fake, close, clearBadge, started };
}

const within_ = () => within(root);
const text = (label: string) => (within_().getByLabelText(label) as HTMLInputElement | HTMLSelectElement).value;
const type = (label: string, value: string) => fireEvent.input(within_().getByLabelText(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(within_().getByRole("button", { name }));
const send = async () => {
  fireEvent.submit(root.querySelector("form")!);
  await waitFor(() => expect(within_().getByRole("button", { name: "Done" }).hidden).toBe(false));
};

describe("a browser that is not paired", () => {
  it("asks for the code, and says how to get one", async () => {
    const { started, clearBadge } = open({});
    await started;
    expect(clearBadge).toHaveBeenCalled();
    expect(within_().getByRole("heading", { name: "Send to KastenFlow" })).toBeTruthy();
    expect(within_().getByText(/Settings → Browser extension/)).toBeTruthy();
    expect(within_().getByLabelText("Pairing code")).toBe(document.activeElement);
    expect(text("Port KastenFlow listens on")).toBe("7434");
  });

  it("pairs with the right code, keeps the token, and goes on to the capture form", async () => {
    const { started, fake, storage } = open({});
    await started;
    type("Pairing code", "ABCD-2345");
    fireEvent.submit(root.querySelector("form")!);
    await waitFor(() => expect(within_().getByRole("button", { name: "Send to KastenFlow" })).toBeTruthy());
    expect(fake.calls[0]).toMatchObject({ path: "/v1/pair", body: { code: "ABCD-2345", label: "Edge" } });
    expect(storage.data["token"]).toBe(TOKEN);
    expect(storage.data["vault"]).toBe("Notes");
    expect(within_().getByRole("status").textContent).toContain("Paired with Notes");
  });

  it("says what Kasten said about a wrong code, and can try again", async () => {
    const { started, storage } = open({}, (call) => (call.path === "/v1/pair" ? { status: 403, body: { error: "That code is not right. 4 tries are left" } } : undefined));
    await started;
    type("Pairing code", "WRONGONE");
    fireEvent.submit(root.querySelector("form")!);
    expect((await within_().findByRole("alert")).textContent).toBe("That code is not right. 4 tries are left");
    expect(storage.data["token"]).toBeUndefined();
    expect((within_().getByRole("button", { name: "Pair" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says Kasten is not there when it is closed, and sends to the port that was typed", async () => {
    const { started, fake, storage } = open({}, () => "closed");
    await started;
    type("Port KastenFlow listens on", "7500");
    type("Pairing code", "ABCD2345");
    fireEvent.submit(root.querySelector("form")!);
    expect((await within_().findByRole("alert")).textContent).toContain("127.0.0.1:7500");
    expect(fake.calls[0]!.url).toBe("http://127.0.0.1:7500/v1/pair");
    expect(storage.data["port"]).toBe(7500);
  });

  it("refuses a port that is not one", async () => {
    const { started, fake } = open({});
    await started;
    for (const port of ["80", "70000", "abc", ""]) {
      type("Port KastenFlow listens on", port);
      fireEvent.submit(root.querySelector("form")!);
      expect((await within_().findByRole("alert")).textContent).toBe("A port is a number from 1024 to 65535.");
    }
    expect(fake.calls).toEqual([]);
  });
});

describe("a paired browser", () => {
  it("offers the selection first, with the page's title, and the places Kasten lists", async () => {
    const { started, fake } = open();
    await started;
    expect(fake.calls.map((c) => c.path)).toEqual(["/v1/targets"]);
    expect(text("Title")).toBe("Slip-box basics");
    const selection = within_().getByRole("radio", { name: /The selection \(4 words\)/ }) as HTMLInputElement;
    expect(selection.checked).toBe(true);
    expect((within_().getByRole("radio", { name: "The page" }) as HTMLInputElement).checked).toBe(false);
    const where = within_().getByLabelText("Send to") as HTMLSelectElement;
    expect([...where.options].map((o) => [o.value, o.textContent])).toEqual([
      ["inbox", "Captures (a card in your inbox)"],
      ["project:trip", "Trip"],
      ["project:work", "Work"],
      ["page:library/reading.md", "Reading list"],
    ]);
    expect(where.value).toBe("inbox");
    expect(within_().getByText(/Connected to Notes/)).toBeTruthy();
    expect(within_().getByText(/The selection · /)).toBeTruthy();
  });

  it("sends the selection to the inbox, then says so and offers Done", async () => {
    const { started, fake, storage, close } = open();
    await started;
    await send();
    const sent = fake.calls.find((c) => c.path === "/v1/capture")!;
    expect(sent.body).toEqual({ url: TAB.url, title: "Slip-box basics", html: "<p>One idea per note.</p>", target: { kind: "inbox" } });
    expect(within_().getByText(/Sent to Captures: Slip-box basics/)).toBeTruthy();
    expect(root.querySelector<HTMLButtonElement>("button[type=submit]")!.hidden).toBe(true);
    expect(storage.data["lastTarget"]).toEqual({ kind: "inbox" });
    press("Done");
    expect(close).toHaveBeenCalled();
  });

  it("sends the page to a project, with tags and the title as edited, and remembers the place", async () => {
    const { started, fake, storage } = open();
    await started;
    fireEvent.click(within_().getByRole("radio", { name: "The page" }));
    type("Title", "My own title");
    fireEvent.change(within_().getByLabelText("Send to"), { target: { value: "project:trip" } });
    type("Tags", "reading, #rust later");
    await send();
    expect(fake.calls.find((c) => c.path === "/v1/capture")!.body).toEqual({ url: TAB.url, title: "My own title", html: READ.html, target: { kind: "project", project: "trip" }, tags: ["reading", "rust", "later"] });
    expect(storage.data["lastTarget"]).toEqual({ kind: "project", project: "trip" });
    expect(within_().getByText(/Sent to trip/)).toBeTruthy();
  });

  it("sends only the link when asked, and a quote into a page", async () => {
    const { started, fake } = open();
    await started;
    fireEvent.click(within_().getByRole("radio", { name: "Only the link" }));
    fireEvent.change(within_().getByLabelText("Send to"), { target: { value: "page:library/reading.md" } });
    await send();
    expect(fake.calls.find((c) => c.path === "/v1/capture")!.body).toEqual({ url: TAB.url, title: "Slip-box basics", target: { kind: "page", path: "library/reading.md" } });
  });

  it("starts on the page when nothing is selected, and has no selection to pick", async () => {
    const { started } = open(undefined, undefined, { page: { ...READ, selectionHtml: "", selectionText: "" } });
    await started;
    const selection = within_().getByRole("radio", { name: "The selection (none)" }) as HTMLInputElement;
    expect(selection.disabled).toBe(true);
    expect((within_().getByRole("radio", { name: "The page" }) as HTMLInputElement).checked).toBe(true);
  });

  it("keeps to the link for a page the browser will not let it read", async () => {
    const { started, fake } = open(undefined, undefined, { page: null });
    await started;
    expect((within_().getByRole("radio", { name: "The page" }) as HTMLInputElement).disabled).toBe(true);
    expect((within_().getByRole("radio", { name: "Only the link" }) as HTMLInputElement).checked).toBe(true);
    await send();
    expect(fake.calls.find((c) => c.path === "/v1/capture")!.body).toEqual({ url: TAB.url, title: "Slip-box basics", target: { kind: "inbox" } });
  });

  it("sends nothing from a page that is not a web page", async () => {
    const { started, fake } = open(undefined, undefined, { tab: { id: 1, url: "chrome://extensions", title: "Extensions" }, page: null });
    await started;
    expect((within_().getByRole("button", { name: "Send to KastenFlow" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within_().getByText("Only web pages can be sent.")).toBeTruthy();
    expect(fake.calls.map((c) => c.path)).toEqual(["/v1/targets"]);
  });

  it("will not send tags that cannot be tags, and says which", async () => {
    const { started, fake } = open();
    await started;
    type("Tags", "ok a:b");
    fireEvent.submit(root.querySelector("form")!);
    expect((await within_().findByRole("alert")).textContent).toContain("These cannot be tags: a:b");
    expect(fake.calls.map((c) => c.path)).toEqual(["/v1/targets"]);
  });

  it("says what Kasten said when it cannot keep a capture, and lets the person send again", async () => {
    let refuse = true;
    const { started, fake } = open(undefined, (call) => (call.path === "/v1/capture" && refuse ? { status: 422, body: { error: "There is nothing to keep in that selection" } } : undefined));
    await started;
    fireEvent.submit(root.querySelector("form")!);
    expect((await within_().findByRole("alert")).textContent).toBe("There is nothing to keep in that selection");
    expect((within_().getByRole("button", { name: "Send to KastenFlow" }) as HTMLButtonElement).disabled).toBe(false);
    refuse = false;
    await send();
    expect(fake.calls.filter((c) => c.path === "/v1/capture")).toHaveLength(2);
  });

  it("goes back to pairing, with what Kasten said, when its token is no good", async () => {
    const { started, storage } = open(undefined, (call) => (call.path === "/v1/targets" ? { status: 401, body: { error: "This extension is not paired, or its pairing was revoked." } } : undefined));
    await started;
    expect((await within_().findByRole("alert")).textContent).toContain("revoked");
    expect(within_().getByLabelText("Pairing code")).toBeTruthy();
    expect(storage.data["token"]).toBeUndefined();
  });

  it("goes back to pairing when the token stops working at the moment of sending", async () => {
    const { started, storage } = open(undefined, (call) => (call.path === "/v1/capture" ? { status: 401, body: { error: "Pair again." } } : undefined));
    await started;
    fireEvent.submit(root.querySelector("form")!);
    await waitFor(() => expect(within_().getByLabelText("Pairing code")).toBeTruthy());
    expect(storage.data["token"]).toBeUndefined();
    expect(within_().getByRole("alert").textContent).toBe("Pair again.");
  });

  it("says Kasten is not there, and tries again when asked", async () => {
    let closed = true;
    const { started, fake } = open(undefined, () => (closed ? "closed" : undefined));
    await started;
    expect((await within_().findByRole("alert")).textContent).toContain("KastenFlow did not answer at 127.0.0.1:7434");
    expect(within_().queryByLabelText("Title")).toBeNull();
    closed = false;
    press("Try again");
    expect(await within_().findByLabelText("Title")).toBeTruthy();
    expect(fake.calls.filter((c) => c.path === "/v1/targets")).toHaveLength(2);
  });

  it("forgets the token when unpaired here, and says to revoke it in Kasten too", async () => {
    const { started, storage } = open();
    await started;
    press("Unpair this browser");
    await waitFor(() => expect(within_().getByLabelText("Pairing code")).toBeTruthy());
    expect(storage.data["token"]).toBeUndefined();
    expect(within_().getByText(/Revoke it in KastenFlow's Settings/)).toBeTruthy();
  });

  it("tells how the last right-click send went, once", async () => {
    const stored = { token: TOKEN, vault: "Notes", [LAST_RESULT]: { ok: false, text: "Kasten did not answer at 127.0.0.1:7434.", at: 1 } };
    const first = open(stored);
    await first.started;
    expect(within_().getByRole("alert").textContent).toBe("Kasten did not answer at 127.0.0.1:7434.");
    expect(first.storage.data[LAST_RESULT]).toBeUndefined();
    root.replaceChildren();
    const again = open(first.storage.data);
    await again.started;
    expect(within_().queryByText(/did not answer/)).toBeNull();
  });
});
