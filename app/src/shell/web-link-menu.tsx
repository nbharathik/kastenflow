// The right-click menu on a web link in a page (and in a chat, a card, a property): the same six choices as on a link in a slide show and in
// the slide editor, in the same words. A preview opens the page in the Slides preview (a calm window over the dimmed page, beside it, or
// over the whole window), which is the browser's native view, so it needs the browser on; with it off the preview says so and offers to
// turn it on. Loaded when first used: nothing here is on the start-up path.

import "./link-preview.css";

import { createRoot, type Root } from "react-dom/client";

import { openUrl } from "../lib/api";
import { openInKastenTab } from "../features/browser/open";
import { useWorkspace } from "../features/workspace/store";
import type { MenuEntry } from "./menu-types";
import { PointMenu } from "./PointMenu";

type Way = "center" | "side" | "full";

let menu: { root: Root; box: HTMLElement } | null = null;
let preview: { root: Root; box: HTMLElement } | null = null;

const away = (shown: { root: Root; box: HTMLElement }): void => {
  // After the click that closed it has finished: a root is not taken down in the middle of its own event.
  queueMicrotask(() => {
    shown.root.unmount();
    shown.box.remove();
  });
};

export function closeWebLinkMenu(): void {
  if (menu) away(menu);
  menu = null;
}

export function closeLinkPreview(): void {
  if (preview) away(preview);
  preview = null;
}

function toast(message: string): void {
  useWorkspace.getState().toast(message);
}

/** Shows the page in the Slides preview, in the way asked. */
export async function previewLink(url: string, way: Way): Promise<void> {
  const [{ WebPreviewPanel }, { webPreviewHost }] = await Promise.all([import("@kasten-slides/react"), import("../features/slides/web-preview")]);
  closeLinkPreview();
  const box = document.createElement("div");
  box.className = "kasten-link-preview";
  document.body.append(box);
  const root = createRoot(box);
  preview = { root, box };
  root.render(
    <WebPreviewPanel
      host={webPreviewHost()}
      url={url}
      surface="show"
      initialMode={way}
      onClose={closeLinkPreview}
      openExternally={(address) => void openUrl(address).catch((err: unknown) => toast(err instanceof Error ? err.message : String(err)))}
      openInTab={openInKastenTab}
    />,
  );
}

/** The six choices, each doing what its words say. */
export function webLinkItems(url: string): MenuEntry[] {
  const ask = (way: Way) => () => void previewLink(url, way);
  return [
    { label: "Preview here", onSelect: ask("center") },
    { label: "Preview beside", onSelect: ask("side") },
    { label: "Full screen", onSelect: ask("full") },
    "divider",
    { label: "Open in a KastenFlow tab", onSelect: () => openInKastenTab(url) },
    { label: "Open in my browser", onSelect: () => void openUrl(url).catch((err: unknown) => toast(err instanceof Error ? err.message : String(err))) },
    "divider",
    { label: "Copy link", onSelect: () => void navigator.clipboard?.writeText(url)?.catch(() => toast("Could not copy the link.")) },
  ];
}

/** Opens the menu for a link at the pointer. */
export function showWebLinkMenu(url: string, x: number, y: number): void {
  closeWebLinkMenu();
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  menu = { root, box };
  root.render(<PointMenu x={x} y={y} label="Link" items={webLinkItems(url)} onClose={closeWebLinkMenu} />);
}
