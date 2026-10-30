// Starting a presentation from the editor: the deck as it is now, from the first slide or the one on the screen, with the
// presenter's window if asked. The editor's default "present" action calls this, and a host that wants to do it another way
// gives its own action instead.

import type { SlidesHost } from "../editor/host.ts";
import type { EditorSession } from "../editor/session/session.ts";
import { readMatte } from "./matte.ts";
import { type Presentation, openPresentation, presenting } from "./open.tsx";
import { openBroadcastPresenter } from "./open-presenter.ts";
import { readControls, readToolbar } from "./options.ts";
import { showScreen } from "./screen.ts";
import type { ShowScreens } from "./runtime/chrome.js";
import type { PresentSync } from "./sync.ts";

export interface PresentOptions {
  /** The slides one at a time (the default), or the whole deck as one page with its notes. */
  view?: "slides" | "scroll";
  /** Also open the presenter's window. */
  presenter?: boolean;
  /** A rehearsal: the presenter's window is opened and starts timing the talk. Nothing advances by itself. */
  rehearse?: boolean;
}

/** What the show can do about screens while it runs; none where the host cannot move a show. */
export function showScreens(host: SlidesHost): ShowScreens | undefined {
  const screens = host.screens;
  if (!screens?.swap || !screens.moveTo || !screens.list) return undefined;
  const { list, swap, moveTo, identify } = screens;
  return {
    list: () => list.call(screens),
    swap: () => void swap.call(screens),
    moveTo: (label) => void moveTo.call(screens, label),
    ...(identify ? { identify: () => void identify.call(screens) } : {}),
  };
}

export async function presentDeck(session: EditorSession, host: SlidesHost, from: "start" | "current", options: PresentOptions = {}): Promise<void> {
  const deck = session.deck;
  const start = from === "start" ? 0 : Math.max(0, deck.slides.findIndex((slide) => slide.id === session.state.slideId));
  // One talk at a time: asking again must not make the host get ready (and hold the window) for a show that never opens.
  if (presenting()) return;
  const imageUrl = (path: string): string | undefined => host.imageUrl(path);
  const moving = showScreens(host);
  const finished = await host.willPresent?.(deck);
  let link: PresentSync | null = null;
  let presentation: Presentation | null = null;
  // The screen is the host's to fill; the show ends with it when the person leaves full screen some other way.
  const screen = showScreen(host.fillScreen?.bind(host), () => presentation?.close());

  // The presenter's window: opened on the host's terms, else as a browser window. It may be asked for again (the S key) once the
  // presentation is up: with a window already open, or being opened, that asks for nothing.
  let opening = false;
  const openLink = async (): Promise<void> => {
    if (link || opening) return;
    opening = true;
    try {
      const made = host.openPresenter ? await host.openPresenter() : openBroadcastPresenter();
      if (!made) {
        host.notify?.("The presenter view could not be opened. Allow this page to open a window and try again.");
        return;
      }
      // The show may have ended while the window was opening.
      if (closed) {
        made.close();
        return;
      }
      link = made;
      // The window was closed: the link is let go, and the S key opens a window again.
      const stop = made.subscribe((message) => {
        if (message.type !== "bye" || link !== made) return;
        stop();
        link = null;
        made.close();
        presentation?.update({ sync: null });
      });
      presentation?.update({ sync: made });
    } finally {
      opening = false;
    }
  };

  const closeLink = (): void => {
    const held = link;
    link = null;
    held?.close();
  };
  let closed = false;

  try {
    // The screen first: with two displays the host moves this window to the external one, and the presenter's window is then placed
    // on the display that is left.
    await screen?.enter();
    if ((options.presenter === true || options.rehearse === true) && options.view !== "scroll") await openLink();

    presentation = openPresentation({
      deck,
      start,
      imageUrl,
      sync: link,
      // What the person chose in the slideshow options: the colour round a slide on a screen of another shape, and the arrows.
      matte: readMatte(),
      controls: readControls(),
      toolbar: readToolbar(),
      ...(moving ? { screens: moving } : {}),
      ...(options.view ? { view: options.view } : {}),
      ...(options.rehearse ? { rehearse: true } : {}),
      onPresenter: () => void openLink(),
      // The host's own pages: the ones a deck embeds are read through it, and a link to one opens its panel.
      pages: host,
      ...(screen ? { fullscreen: screen.toggle } : {}),
      onClosed: () => {
        closed = true;
        finished?.();
        screen?.release();
        link?.post({ type: "bye" });
        closeLink();
      },
    });
  } catch (error) {
    // Nothing opened: the host is told the show is over and the screen goes back, whatever failed.
    closed = true;
    finished?.();
    screen?.release();
    closeLink();
    throw error;
  }
}
