// The link card over a link in a text box: Preview, and the right-click menu with the same six choices as on a link in a show.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TextEditorHandle } from "../../text/index.ts";
import type { LinkActions } from "./link-actions.ts";
import { LinkPopover } from "./LinkPopover.tsx";

const WEB = "https://example.com/x";
const anchor = { left: 10, top: 10, right: 20, bottom: 20 };

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

function card(href: string, actions?: Partial<LinkActions>) {
  const onClose = vi.fn();
  const full: LinkActions = { preview: vi.fn(), tab: vi.fn(), browser: vi.fn(), ...actions };
  const handle = { setLink: vi.fn(), insertLink: vi.fn(), focus: vi.fn() } as unknown as TextEditorHandle;
  render(<LinkPopover handle={handle} mode="card" href={href} anchor={anchor} hasSelection={false} onClose={onClose} onEdit={() => {}} actions={full} />);
  return { full, onClose };
}

const rows = () => screen.queryAllByRole("menuitem").map((row) => row.textContent);
const item = (name: string) => screen.getByRole("menuitem", { name });
const menuAt = () => fireEvent.contextMenu(screen.getByText("Link").closest(".ks-tui-link")!, { clientX: 30, clientY: 30 });

describe("the link card", () => {
  it("has a Preview button for a web page, which shows it in the preview and closes the card", () => {
    const { full, onClose } = card(WEB);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(full.preview).toHaveBeenCalledWith(WEB);
    expect(onClose).toHaveBeenCalled();
  });

  it("has no Preview for mail, or where the host has no preview", () => {
    card("mailto:me@example.com");
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
    cleanup();
    render(<LinkPopover handle={{} as TextEditorHandle} mode="card" href={WEB} anchor={anchor} hasSelection={false} onClose={vi.fn()} onEdit={() => {}} actions={{ browser: vi.fn() }} />);
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
    menuAt();
    expect(rows()).toEqual(["Open in my browser", "Copy link"]);
  });

  it("opens the six choices on a right-click, and each asks the right thing of the host", () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { full } = card(WEB);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 30 });
    act(() => void screen.getByText("Link").closest(".ks-tui-link")!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(rows()).toEqual(["Preview here", "Preview beside", "Full screen", "Open in a KastenFlow tab", "Open in my browser", "Copy link"]);
    fireEvent.click(item("Preview beside"));
    expect(full.preview).toHaveBeenLastCalledWith(WEB, "side");
    menuAt();
    fireEvent.click(item("Preview here"));
    expect(full.preview).toHaveBeenLastCalledWith(WEB, "center");
    menuAt();
    fireEvent.click(item("Full screen"));
    expect(full.preview).toHaveBeenLastCalledWith(WEB, "full");
    menuAt();
    fireEvent.click(item("Open in a KastenFlow tab"));
    expect(full.tab).toHaveBeenCalledWith(WEB);
    menuAt();
    fireEvent.click(item("Open in my browser"));
    expect(full.browser).toHaveBeenCalledWith(WEB);
    menuAt();
    fireEvent.click(item("Copy link"));
    expect(writeText).toHaveBeenCalledWith(WEB);
  });

  it("leaves out the rows the host cannot do, and has no menu on a link that is not a web page", () => {
    render(<LinkPopover handle={{} as TextEditorHandle} mode="card" href={WEB} anchor={anchor} hasSelection={false} onClose={vi.fn()} onEdit={() => {}} actions={{ preview: vi.fn(), browser: vi.fn() }} />);
    menuAt();
    expect(rows()).toEqual(["Preview here", "Preview beside", "Full screen", "Open in my browser", "Copy link"]);
    cleanup();
    card("mailto:me@example.com");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    act(() => void screen.getByText("Link").closest(".ks-tui-link")!.dispatchEvent(event));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
