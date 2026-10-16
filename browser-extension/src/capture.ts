// Turning what was read into a capture Kasten will take: under its size, with
// tags that are tags, and the right-click choices (page, selection, link,
// picture) as requests.

import type { MenuClick, PageRead, ReadTab, Tab } from "./env.js";
import type { CaptureRequest, PaperTags, Target } from "./model.js";
import { isWebPage } from "./page.js";

/** The most a request's JSON may be: under the 2 MB Kasten takes. */
export const MAX_BYTES = 1_900_000;
/** The most tags a capture carries, and the longest tag. */
export const MAX_TAGS = 8;
export const MAX_TAG = 40;

export type What = "selection" | "page" | "link";

const bytes = (text: string): number => new TextEncoder().encode(text).length;
const size = (request: CaptureRequest): number => bytes(JSON.stringify(request));

/** Tags typed as words (`reading, #rust async`): the ones that can be tags, and those that cannot. */
export function parseTags(typed: string): { tags: string[]; bad: string[] } {
  const tags: string[] = [];
  const bad: string[] = [];
  for (const word of typed.split(/[\s,;]+/)) {
    const tag = word.replace(/^#+/, "");
    if (!tag) continue;
    if (!new RegExp(`^[\\p{L}\\p{N}_/-]{1,${MAX_TAG}}$`, "u").test(tag)) bad.push(word);
    else if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  if (tags.length > MAX_TAGS) {
    bad.push(...tags.splice(MAX_TAGS));
  }
  return { tags, bad };
}

/** What `text` takes up in a request's JSON: its bytes, with the escapes a new line or a quote needs. */
const jsonBytes = (text: string): number => bytes(JSON.stringify(text)) - 2;

/** The start of `text` that fits `room` bytes of JSON, cut at a line or a space, and whether anything was cut. */
export function fit(text: string, room: number): { text: string; cut: boolean } {
  if (jsonBytes(text) <= room) return { text, cut: false };
  let end = Math.max(0, Math.min(text.length, room));
  while (end > 0 && jsonBytes(text.slice(0, end)) > room) end = Math.floor(end * 0.9);
  let head = text.slice(0, end);
  const line = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
  if (line > end * 0.8) head = head.slice(0, line);
  // Half of a letter written as two parts (an emoji) is not text Kasten can read.
  if (/[\ud800-\udbff]$/.test(head)) head = head.slice(0, -1);
  return { text: head.trimEnd(), cut: true };
}

export interface Built {
  request: CaptureRequest;
  /** What went in: the selection, the page's markup, the page's plain text, or the link alone. */
  kept: "selection" | "page" | "text" | "link";
  /** The text was cut to fit. */
  cut: boolean;
}

export interface BuildOptions {
  url: string;
  title: string;
  read: PageRead | null;
  what: What;
  target: Target;
  tags: string[];
}

/** The capture for `what`: the page's markup if it fits, else its text, else the start of that; a link when there is nothing to take. */
export function build({ url, title, read, what, target, tags }: BuildOptions): Built {
  const base: CaptureRequest = { url, title: title.trim().slice(0, 300), target };
  if (tags.length > 0) base.tags = tags;
  const markup = what === "selection" ? read?.selectionHtml : what === "page" ? read?.html : "";
  const plain = what === "selection" ? read?.selectionText : what === "page" ? read?.text : "";
  const options: { request: CaptureRequest; kept: Built["kept"] }[] = [];
  if (markup?.trim()) options.push({ request: { ...base, html: markup }, kept: what === "selection" ? "selection" : "page" });
  if (plain?.trim()) options.push({ request: { ...base, text: plain }, kept: what === "selection" ? "selection" : "text" });
  for (const option of options) {
    if (size(option.request) <= MAX_BYTES) return { ...option, cut: false };
  }
  const last = options.at(-1);
  if (last?.request.text !== undefined) {
    const room = MAX_BYTES - size({ ...base, text: "" }) - 1024;
    const { text } = fit(last.request.text, Math.max(0, room));
    return { request: { ...base, text }, kept: last.kept, cut: true };
  }
  return { request: base, kept: "link", cut: false };
}

/** The request "Save as paper" sends: the page's address and title with its tags and nothing of its text. Tags are dropped from the end, never the request refused, if the page has so many that it would not fit. */
export function buildPaper({ url, title, tags }: { url: string; title: string; tags: PaperTags }): CaptureRequest {
  const base = { url, title: title.trim().slice(0, 300) };
  let meta = tags.meta;
  const request = (): CaptureRequest => ({ ...base, paper: { meta, ld: tags.ld } });
  while (size(request()) > MAX_BYTES && meta.length > 0) meta = meta.slice(0, Math.floor(meta.length / 2));
  return request();
}

/** What a picture's capture holds: its address, as a picture, in the page it is on. */
const pictureHtml = (src: string): string => `<p><img src="${src.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}" alt=""></p>`;

/** Right-click menu entries: an id, what it says and where it shows. */
export const MENU_ITEMS = [
  { id: "kasten-selection", title: "Send selection to KastenFlow", contexts: ["selection"] },
  { id: "kasten-link", title: "Send link to KastenFlow", contexts: ["link"] },
  { id: "kasten-image", title: "Send picture to KastenFlow", contexts: ["image"] },
  { id: "kasten-page", title: "Send page to KastenFlow", contexts: ["page"] },
] as const;

/** The capture a right-click asked for, going to `target`. Throws what went wrong, in words. */
export async function requestFromMenu(click: MenuClick, tab: Tab | undefined, read: ReadTab, target: Target): Promise<Built> {
  const here = tab?.url ?? click.pageUrl;
  const tabRead = async (): Promise<PageRead | null> => (tab?.id !== undefined && isWebPage(here) ? read(tab.id).catch(() => null) : null);
  switch (click.menuItemId) {
    case "kasten-link": {
      if (!isWebPage(click.linkUrl)) throw new Error("Only web addresses can be sent to KastenFlow.");
      return build({ url: click.linkUrl, title: click.selectionText ?? "", read: null, what: "link", target, tags: [] });
    }
    case "kasten-image": {
      if (!isWebPage(here)) throw new Error("Only pictures on web pages can be sent to KastenFlow.");
      if (!isWebPage(click.srcUrl)) throw new Error("That picture is not a web address, so KastenFlow cannot keep it. Send the page instead.");
      const picture: PageRead = { title: tab?.title ?? "", selectionHtml: pictureHtml(click.srcUrl), selectionText: "", html: "", text: "" };
      return build({ url: here, title: tab?.title ?? "", read: picture, what: "selection", target, tags: [] });
    }
    case "kasten-selection": {
      if (!isWebPage(here)) throw new Error("Only web pages can be sent to KastenFlow.");
      const page = await tabRead();
      const withText: PageRead | null = page?.selectionText.trim() ? page : click.selectionText ? { title: tab?.title ?? "", selectionHtml: "", selectionText: click.selectionText, html: "", text: "" } : page;
      return build({ url: here, title: tab?.title ?? page?.title ?? "", read: withText, what: "selection", target, tags: [] });
    }
    case "kasten-page": {
      if (!isWebPage(here)) throw new Error("Only web pages can be sent to KastenFlow.");
      const page = await tabRead();
      return build({ url: here, title: tab?.title ?? page?.title ?? "", read: page, what: page ? "page" : "link", target, tags: [] });
    }
    default:
      throw new Error("KastenFlow does not know that menu entry.");
  }
}
