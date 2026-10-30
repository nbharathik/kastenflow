// Puts a presentation over the whole window: in a root of its own, on the page's body, so that what the editor underneath
// does with keys never sees them, and the editor is made inert (no focus, no clicks) until the presentation ends.

import type { Deck } from "@kasten-slides/wasm";
import { createRoot } from "react-dom/client";

import { editorOf, giveFocusBack, lastEditorRoot } from "../editor/focus/home.ts";
import type { ImageUrl } from "../render/index.ts";
import type { Matte } from "./matte.ts";
import { PresentMode, type PresentModeProps } from "./PresentMode.tsx";
import type { PresentSync } from "./sync.ts";

export interface PresentRequest {
  deck: Deck;
  /** Where to begin: the place of a slide among the deck's slides. */
  start: number;
  imageUrl: ImageUrl;
  view?: "slides" | "scroll";
  /** The colour round the slide on a screen of another shape (black when left out). */
  matte?: Matte;
  /** Whether the arrows and the progress bar show (off when left out). */
  controls?: boolean;
  /** Whether the mouse toolbar shows at the bottom left while the pointer moves (off when left out). */
  toolbar?: boolean;
  /** The displays the show may be on (the toolbar's screen menu). */
  screens?: PresentModeProps["screens"];
  /** The link to a presenter's window that is already open. */
  sync?: PresentSync | null;
  /** What the S key does. */
  onPresenter?: () => void;
  /** The talk is a rehearsal: the presenter's window starts timing it. */
  rehearse?: boolean;
  /** What the F key does; the page's own full screen when left out. */
  fullscreen?: () => void;
  /** What the host gives the slides to do with its own pages (a presentation's links to them, and the pages a deck embeds). */
  pages?: PresentModeProps["pages"];
  /** Called once the presentation has closed. */
  onClosed?: () => void;
}

/** A presentation that is open. */
export interface Presentation {
  close(): void;
  /** Changes what it was opened with (the link to a presenter's window that has opened since, say). */
  update(changes: Partial<PresentRequest>): void;
}

let current: Presentation | null = null;

/** Whether a presentation is open. */
export const presenting = (): boolean => current !== null;

/** Opens a presentation over the window. Only one is open at a time: asking for another gives the one open. */
export function openPresentation(request: PresentRequest): Presentation {
  if (current) return current;
  // Where the keys were: the page loses its focus when it is made inert, and is given it back when the presentation ends.
  const returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const host = document.createElement("div");
  host.className = "ks-show-root";
  document.body.append(host);
  const held = [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== host && !node.inert);
  for (const node of held) node.inert = true;
  const root = createRoot(host);
  let props = request;
  let closed = false;
  const draw = () => {
    const { onClosed: _closed, ...shown } = props;
    root.render(<PresentMode {...shown} onExit={close} />);
  };
  function close(): void {
    if (closed) return;
    closed = true;
    current = null;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    // Not while a component is handling the click or the key that closed it.
    queueMicrotask(() => {
      root.unmount();
      host.remove();
      for (const node of held) node.inert = false;
      // Where the keys were; and when that place is gone (a menu row the show was started from) the editor's home, not the page.
      giveFocusBack(returnTo, editorOf(returnTo) ?? lastEditorRoot());
      props.onClosed?.();
    });
  }
  const made: Presentation = {
    close,
    update(changes) {
      if (closed) return;
      props = { ...props, ...changes };
      draw();
    },
  };
  current = made;
  draw();
  return made;
}
