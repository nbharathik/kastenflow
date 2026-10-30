// The menu a right-click on a web link opens, in a show, in the editor and on the header of the page preview: the same six choices
// everywhere, in the same words. It is the editor's own menu (a menu drawn in the page, not the system's), so it works during a show,
// and a native web view steps aside while it is open. Keys in it stay in it: an arrow never moves the slides behind.

import type { JSX, KeyboardEvent } from "react";

import { type MenuItem, Menu } from "../editor/ui/Menu.tsx";
import { type Anchor } from "../editor/ui/Popover.tsx";
import "./link-menu.css";

/** What the person can do with a web link. */
export type LinkChoice = "here" | "side" | "full" | "tab" | "browser" | "copy";

/** The rows, with what each does; the preview rows are left out where the host cannot show a page. */
export function linkMenuItems(choose: (choice: LinkChoice) => void, options: { previews?: boolean; tab?: boolean } = {}): MenuItem[] {
  const { previews = true, tab = true } = options;
  const item = (id: LinkChoice, label: string, icon: Extract<MenuItem, { id: string }>["icon"]): MenuItem => ({ id, label, ...(icon ? { icon } : {}), run: () => choose(id) });
  return [
    ...(previews ? [item("here", "Preview here", "rectangle-horizontal"), item("side", "Preview beside", "panel-right"), item("full", "Full screen", "expand"), { kind: "separator" } as const] : []),
    ...(tab ? [item("tab", "Open in a KastenFlow tab", "globe")] : []),
    item("browser", "Open in my browser", "external-link"),
    { kind: "separator" },
    item("copy", "Copy link", "copy"),
  ];
}

export interface LinkMenuProps {
  anchor: Anchor;
  onClose(): void;
  onChoose(choice: LinkChoice): void;
  previews?: boolean;
  tab?: boolean;
}

const keep = (event: KeyboardEvent): void => event.stopPropagation();

export function LinkMenu({ anchor, onClose, onChoose, previews, tab }: LinkMenuProps): JSX.Element {
  return (
    <div className="ks-link-menu" style={{ display: "contents" }} onKeyDown={keep} onContextMenu={(event) => event.preventDefault()}>
      <Menu items={linkMenuItems(onChoose, { ...(previews === undefined ? {} : { previews }), ...(tab === undefined ? {} : { tab }) })} anchor={anchor} onClose={onClose} label="Link" />
    </div>
  );
}

/** Puts the address on the clipboard. Nothing happens where the page may not use the clipboard. */
export function copyLink(address: string): void {
  void navigator.clipboard?.writeText(address)?.catch(() => {});
}

/** Whether an address is a web page the preview can show (mail and phone links are not). */
export const isWebPage = (address: string): boolean => /^https?:\/\//i.test(address);
