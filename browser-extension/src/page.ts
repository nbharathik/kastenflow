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
  const root = document.documentElement.cloneNode(true) as HTMLElement;
  for (const node of root.querySelectorAll("script, style, noscript, template, iframe, object, embed, canvas, video, audio, link, meta, svg")) node.remove();
  return {
    title: document.title,
    selectionHtml,
    selectionText,
    html: root.outerHTML,
    text: document.body ? (document.body.innerText ?? document.body.textContent ?? "") : "",
  };
}

/** Whether `url` is a web page the extension may send. */
export function isWebPage(url: string | undefined): url is string {
  return typeof url === "string" && /^https?:\/\/[^\s/@]+(?:[/?#]|$)/i.test(url);
}
