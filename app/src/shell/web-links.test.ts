import { afterEach, describe, expect, it, vi } from "vitest";

import { followKastenLink, followWebLink } from "./web-links";

function anchor(href: string, where?: HTMLElement): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = "link";
  (where ?? document.body).appendChild(a);
  return a;
}

function click(target: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent(init.button === 1 ? "auxclick" : "click", { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("web links in the desktop app", () => {
  it("opens a web link outside the app, on a click or a middle click", () => {
    const open = vi.fn();
    const a = anchor("https://kasten.app/docs");
    const event = click(a.appendChild(document.createElement("span")));
    followWebLink(event, open);
    expect(open).toHaveBeenCalledWith("https://kasten.app/docs");
    expect(event.defaultPrevented).toBe(true);
    followWebLink(click(a, { button: 1 }), open);
    expect(open).toHaveBeenCalledTimes(2);
    followWebLink(click(anchor("mailto:me@example.com")), open);
    expect(open).toHaveBeenLastCalledWith("mailto:me@example.com");
  });

  it("leaves the app's own links, handled clicks and right clicks alone", () => {
    const open = vi.fn();
    const own = click(anchor("#/library"));
    followWebLink(own, open);
    expect(own.defaultPrevented).toBe(false);
    const handled = click(anchor("https://kasten.app"));
    handled.preventDefault();
    followWebLink(handled, open);
    followWebLink(click(anchor("https://kasten.app"), { button: 2 }), open);
    expect(open).not.toHaveBeenCalled();
  });

  it("takes the window nowhere for a link the app doesn't route", () => {
    const open = vi.fn();
    for (const href of ["../sources/paper.pdf#page=3", "file:///etc/passwd", "javascript:alert(1)", "other.html", ""]) {
      const event = click(anchor(href));
      followWebLink(event, open);
      expect(event.defaultPrevented, href).toBe(true);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it("in text being edited, follows a link only with Ctrl or Cmd, as editors do", () => {
    const open = vi.fn();
    const page = document.createElement("div");
    page.setAttribute("contenteditable", "true");
    document.body.appendChild(page);
    const a = anchor("https://kasten.app", page);
    const plain = click(a);
    followWebLink(plain, open);
    expect(open).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(true);
    followWebLink(click(a, { ctrlKey: true }), open);
    followWebLink(click(a, { metaKey: true }), open);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe("kasten: links", () => {
  const ID = "01J8Z3K6Q2M4X7V9B1C5D8E0F2";

  it("open the place they name, in the way the click asks, and keep the window where it is", () => {
    const open = vi.fn();
    const a = anchor(`kasten:note/${ID}#Risks`);
    const event = click(a.appendChild(document.createElement("span")));
    followKastenLink(event, open);
    expect(open).toHaveBeenLastCalledWith(`kasten:note/${ID}#Risks`, "here");
    expect(event.defaultPrevented).toBe(true);
    followKastenLink(click(a, { ctrlKey: true }), open);
    expect(open).toHaveBeenLastCalledWith(`kasten:note/${ID}#Risks`, "tab");
    followKastenLink(click(a, { button: 1 }), open);
    expect(open).toHaveBeenLastCalledWith(`kasten:note/${ID}#Risks`, "tab");
    followKastenLink(click(a, { shiftKey: true }), open);
    expect(open).toHaveBeenLastCalledWith(`kasten:note/${ID}#Risks`, "stack");
    for (const href of ["kasten:pdf/sources/a.pdf?page=2", "kasten:board/b.canvas?node=n1", "kasten:deck/library/d.deck"]) {
      followKastenLink(click(anchor(href)), open);
      expect(open).toHaveBeenLastCalledWith(href, "here");
    }
  });

  it("leave web links, the app's own links, handled clicks and right clicks alone", () => {
    const open = vi.fn();
    for (const href of ["https://kasten.app", "#/library", "kasten:settings/ai", "mailto:a@b.c"]) {
      const event = click(anchor(href));
      followKastenLink(event, open);
      expect(event.defaultPrevented, href).toBe(false);
    }
    const handled = click(anchor(`kasten:note/${ID}`));
    handled.preventDefault();
    followKastenLink(handled, open);
    followKastenLink(click(anchor(`kasten:note/${ID}`), { button: 2 }), open);
    expect(open).not.toHaveBeenCalled();
  });

  it("in text being edited, follow only with Ctrl or Cmd", () => {
    const open = vi.fn();
    const page = document.createElement("div");
    page.setAttribute("contenteditable", "true");
    document.body.appendChild(page);
    const a = anchor(`kasten:note/${ID}`, page);
    const plain = click(a);
    followKastenLink(plain, open);
    expect(open).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(true);
    followKastenLink(click(a, { ctrlKey: true }), open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenLastCalledWith(`kasten:note/${ID}`, "tab");
  });
});
