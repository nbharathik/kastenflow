// The popup once paired: what to send (the selection, the page or only its
// link), where it goes (Captures, a project or a page), tags, and Send. Kasten
// is asked for the places when it opens, so a Kasten that is closed is said at once.

import { build, parseTags, type Built, type What } from "./capture.js";
import { Kasten } from "./client.js";
import { fill, h } from "./dom.js";
import type { PageRead } from "./env.js";
import type { Settings, Target, Targets } from "./model.js";
import { isWebPage } from "./page.js";
import { noticeLine, trouble, type Notice, type PopupEnv } from "./popup-env.js";
import { forgetPairing, saveLastTarget } from "./settings.js";

const encode = (target: Target): string => (target.kind === "inbox" ? "inbox" : target.kind === "project" ? `project:${target.project}` : `page:${target.path}`);

const decode = (value: string): Target => {
  if (value.startsWith("project:")) return { kind: "project", project: value.slice(8) };
  if (value.startsWith("page:")) return { kind: "page", path: value.slice(5) };
  return { kind: "inbox" };
};

const kb = (n: number): string => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const WORDS: Record<Built["kept"], string> = { selection: "The selection", page: "The page", text: "The page's text", link: "Only the link" };

/** The popup of a paired browser. `again` shows the popup afresh, with a line above it. */
export async function captureView(env: PopupEnv, root: HTMLElement, settings: Settings, notice: Notice | null, again: (notice: Notice | null) => Promise<void>): Promise<void> {
  root.replaceChildren(h("h1", {}, "Send to KastenFlow"), h("p", { role: "status" }, "Reading the page…"));
  const kasten = new Kasten(settings.port, settings.token, env.send);
  const tab = await env.activeTab();
  const web = isWebPage(tab?.url);
  const [places, page] = await Promise.allSettled([kasten.targets(), web && tab?.id !== undefined ? env.read(tab.id).catch(() => null) : Promise.resolve(null)]);
  if (places.status === "rejected") {
    const said = await trouble(env, places.reason);
    // An unpaired browser is asked to pair again; anything else can be tried again.
    if (said.unpaired) return again({ text: said.text, bad: true });
    return failure(env, root, said.text, () => again(null));
  }
  const read: PageRead | null = page.status === "fulfilled" ? page.value : null;
  form(env, root, settings, tab?.url ?? "", tab?.title ?? read?.title ?? "", web, read, places.value, notice, again);
}

function failure(env: PopupEnv, root: HTMLElement, text: string, retry: () => Promise<void>): void {
  root.replaceChildren(
    h("h1", {}, "Send to KastenFlow"),
    h("p", { class: "notice is-bad", role: "alert" }, text),
    h("button", { type: "button", class: "primary", onclick: () => void retry() }, "Try again"),
    h("button", { type: "button", onclick: () => env.close() }, "Close"),
  );
}

function form(env: PopupEnv, root: HTMLElement, settings: Settings, url: string, title: string, web: boolean, read: PageRead | null, places: Targets, notice: Notice | null, again: (notice: Notice | null) => Promise<void>): void {
  const hasSelection = Boolean(read?.selectionText.trim());
  const first: What = hasSelection ? "selection" : read ? "page" : "link";
  const titleField = h("input", { id: "title", name: "title", value: title, maxlength: 300 });
  const radio = (what: What, label: string, on: boolean) => h("label", { class: "choice" }, h("input", { type: "radio", name: "what", value: what, checked: what === first, disabled: !on, onchange: () => summarise() }), label);
  const words = hasSelection ? read!.selectionText.trim().split(/\s+/).length : 0;
  const choices = h(
    "fieldset",
    {},
    h("legend", {}, "What to send"),
    radio("selection", hasSelection ? `The selection (${words} ${words === 1 ? "word" : "words"})` : "The selection (none)", hasSelection),
    radio("page", "The page", read !== null),
    radio("link", "Only the link", web),
  );
  const chosenTarget = encode(settings.lastTarget);
  const known = new Set([...places.projects.map((p) => `project:${p.id}`), ...places.pages.map((p) => `page:${p.path}`)]);
  const option = (value: string, label: string) => h("option", { value, selected: value === chosenTarget && (value === "inbox" || known.has(value)) }, label);
  const where = h(
    "select",
    { id: "where", name: "where" },
    option("inbox", `${places.inbox.name} (a card in your inbox)`),
    places.projects.length > 0 ? h("optgroup", { label: "A card in a project" }, ...places.projects.map((p) => option(`project:${p.id}`, p.name))) : null,
    places.pages.length > 0 ? h("optgroup", { label: "A quote in a page" }, ...places.pages.map((p) => option(`page:${p.path}`, p.title || p.path))) : null,
  );
  const tags = h("input", { id: "tags", name: "tags", placeholder: "reading, rust", autocomplete: "off", spellcheck: "false" });
  const summary = h("p", { class: "hint", "aria-live": "polite" });
  const result = h("p", { role: "status", class: "notice", hidden: true });
  const send = h("button", { type: "submit", class: "primary", disabled: !web }, "Send to KastenFlow");

  const what = (): What => (root.querySelector<HTMLInputElement>("input[name=what]:checked")?.value as What | undefined) ?? first;
  const built = (): Built | string => {
    const parsed = parseTags(tags.value);
    if (parsed.bad.length > 0) return `These cannot be tags: ${parsed.bad.join(", ")}. Use letters, digits, dashes and slashes.`;
    return build({ url, title: titleField.value, read, what: what(), target: decode(where.value), tags: parsed.tags });
  };
  function summarise(): void {
    const made = built();
    summary.textContent = !web ? "Only web pages can be sent." : typeof made === "string" ? made : `${WORDS[made.kept]}${made.cut ? ", cut to fit" : ""} · ${kb(JSON.stringify(made.request).length)}`;
  }
  const say = (text: string, bad: boolean) => {
    result.textContent = text;
    result.className = bad ? "notice is-bad" : "notice";
    result.setAttribute("role", bad ? "alert" : "status");
    result.hidden = false;
  };
  const submit = async () => {
    const made = built();
    if (typeof made === "string") return say(made, true);
    send.disabled = true;
    say("Sending…", false);
    try {
      const saved = await new Kasten(settings.port, settings.token, env.send).capture(made.request);
      await saveLastTarget(env.storage, made.request.target ?? { kind: "inbox" });
      say(`Sent to ${saved.place}: ${saved.title}${made.cut ? ". The page was big, so only the start of its text went." : ""}`, false);
      send.hidden = true;
      done.hidden = false;
      done.focus();
    } catch (error) {
      const said = await trouble(env, error);
      if (said.unpaired) return again({ text: said.text, bad: true });
      say(said.text, true);
      send.disabled = !web;
    }
  };
  const done = h("button", { type: "button", class: "primary", hidden: true, onclick: () => env.close() }, "Done");
  const unpair = h("button", { type: "button", class: "quiet", onclick: () => void forgetPairing(env.storage).then(() => again({ text: "Unpaired here. Revoke it in KastenFlow's Settings, under Browser extension, too.", bad: false })) }, "Unpair this browser");

  fill(
    root,
    h("h1", {}, "Send to KastenFlow"),
    noticeLine(notice),
    h(
      "form",
      {
        onsubmit: (event) => {
          event.preventDefault();
          void submit();
        },
      },
      h("label", { for: "title" }, "Title"),
      titleField,
      choices,
      h("label", { for: "where" }, "Send to"),
      where,
      h("label", { for: "tags" }, "Tags"),
      tags,
      summary,
      result,
      h("div", { class: "actions" }, send, done),
    ),
    h("p", { class: "hint" }, `Connected to ${places.vault || "KastenFlow"}. `, unpair),
  );
  for (const field of [titleField, tags]) field.addEventListener("input", summarise);
  where.addEventListener("change", summarise);
  summarise();
  send.focus();
}
