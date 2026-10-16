// What is read from the page the person is on, when they ask: its selection, and
// the page with its scripts and styles taken out. `readPage` runs inside the tab
// (the browser sends its text there), so it uses nothing but what it holds itself.

import type { PageRead } from "./env.js";

/** Runs in the page. The browser serialises this function and runs it in the
 * tab, so it must not use anything defined outside it. */
export function readPage(): PageRead {
  const selection = window.getSelection();
  let selectionHtml = "";
  let selectionText = "";
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const box = document.createElement("div");
    for (let i = 0; i < selection.rangeCount; i++) box.appendChild(selection.getRangeAt(i).cloneContents());
    selectionHtml = box.innerHTML;
    selectionText = selection.toString();
  }
  // The tags the page describes itself by (read before the copy below loses them): what "Save as paper" sends.
  const meta: [string, string][] = [];
  const tags = document.querySelectorAll("meta[name], meta[property]");
  for (let i = 0; i < tags.length && meta.length < 400; i++) {
    const name = String(tags[i]!.getAttribute("name") ?? tags[i]!.getAttribute("property") ?? "").toLowerCase().slice(0, 100);
    const content = String(tags[i]!.getAttribute("content") ?? "").slice(0, 6000);
    if (name && content) meta.push([name, content]);
  }
  const ld: string[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const text = script.textContent ?? "";
    if (text && text.length <= 100_000 && ld.length < 10) ld.push(text);
  }
  const root = document.documentElement.cloneNode(true) as HTMLElement;
  for (const node of root.querySelectorAll("script, style, noscript, template, iframe, object, embed, canvas, video, audio, link, meta, svg")) node.remove();
  return {
    title: document.title,
    selectionHtml,
    selectionText,
    html: root.outerHTML,
    text: document.body ? (document.body.innerText ?? document.body.textContent ?? "") : "",
    paper: { meta, ld },
  };
}

/** Whether `url` is a web page the extension may send. */
export function isWebPage(url: string | undefined): url is string {
  return typeof url === "string" && /^https?:\/\/[^\s/@]+(?:[/?#]|$)/i.test(url);
}
