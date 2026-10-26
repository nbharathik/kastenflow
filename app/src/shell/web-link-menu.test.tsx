import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openUrl } from "../lib/api";
import { useBrowserPrefs } from "../features/browser/prefs";
import { useWorkspace } from "../features/workspace/store";
import { derive } from "../features/workspace/store-layout";
import { initialLayout } from "../features/workspace/tabs";
import { closeLinkPreview, closeWebLinkMenu, showWebLinkMenu, webLinkItems } from "./web-link-menu";
import { webLinkForMenu } from "./web-links";

vi.mock("../lib/api", async (original) => ({ ...(await original<typeof import("../lib/api")>()), openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("../features/browser/open", () => ({ openInBrowserTab: vi.fn(), openInKastenTab: vi.fn() }));

const WEB = "https://example.com/x";

function anchor(href: string, where?: HTMLElement): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = "link";
  (where ?? document.body).appendChild(a);
  return a;
}

function menuEvent(target: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

beforeEach(() => {
  useBrowserPrefs.setState({ enabled: true, known: true });
  useWorkspace.setState({ ...derive(initialLayout({ view: "home" })), client: {} as never, notes: [], toasts: [] });
  vi.mocked(openUrl).mockClear();
});

afterEach(async () => {
  closeWebLinkMenu();
  closeLinkPreview();
  await act(async () => {});
  document.body.innerHTML = "";
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("which links get the menu", () => {
  it("web links do, and so do things inside them", () => {
    const a = anchor(WEB);
    expect(webLinkForMenu(menuEvent(a))).toBe(WEB);
    expect(webLinkForMenu(menuEvent(a.appendChild(document.createElement("span"))))).toBe(WEB);
  });

  it("mail, scripts, the app's own links, handled right-clicks, and links in text being written do not", () => {
    for (const href of ["mailto:me@example.com", "javascript:alert(1)", "#/library", "../note.md", "file:///etc/passwd"]) expect(webLinkForMenu(menuEvent(anchor(href))), href).toBeNull();
    const handled = menuEvent(anchor(WEB));
    handled.preventDefault();
    expect(webLinkForMenu(handled)).toBeNull();
    const page = document.createElement("div");
    page.setAttribute("contenteditable", "true");
    document.body.appendChild(page);
    expect(webLinkForMenu(menuEvent(anchor(WEB, page)))).toBeNull();
  });
});

describe("the menu", () => {
  const rows = () => [...document.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent);
  const choose = (name: string) => act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((row) => row.textContent === name)!.click());

  it("has the six choices, in the app's own menu", async () => {
    await act(async () => showWebLinkMenu(WEB, 100, 100));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(rows()).toEqual(["Preview here", "Preview beside", "Full screen", "Open in a KastenFlow tab", "Open in my browser", "Copy link"]);
    expect(webLinkItems(WEB).filter((item) => item !== "divider")).toHaveLength(6);
  });

  it("opens in the person's browser, and copies the address", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(async () => showWebLinkMenu(WEB, 100, 100));
    await choose("Open in my browser");
    expect(openUrl).toHaveBeenCalledWith(WEB);
    await act(async () => showWebLinkMenu(WEB, 100, 100));
    await choose("Copy link");
    expect(writeText).toHaveBeenCalledWith(WEB);
  });

  it("opens in a KastenFlow tab through the shared opener", async () => {
    const { openInKastenTab } = await import("../features/browser/open");
    await act(async () => showWebLinkMenu(WEB, 100, 100));
    await choose("Open in a KastenFlow tab");
    expect(openInKastenTab).toHaveBeenCalledWith(WEB);
  });

  it("is replaced by a second menu: one at a time", async () => {
    await act(async () => showWebLinkMenu(WEB, 100, 100));
    await act(async () => showWebLinkMenu("https://example.org/y", 120, 100));
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  });
});
