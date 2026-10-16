// Starting a presentation from the editor: the deck as it is now, from the first slide or the one on the screen, with the
// presenter's window if asked. The editor's default "present" action calls this, and a host that wants to do it another way
// gives its own action instead.

import type { SlidesHost } from "../editor/host.ts";
import type { EditorSession } from "../editor/session/session.ts";
import { readMatte } from "./matte.ts";
import { type Presentation, openPresentation } from "./open.tsx";
import { openBroadcastPresenter } from "./open-presenter.ts";
import type { PresentSync } from "./sync.ts";

export interface PresentOptions {
  /** The slides one at a time (the default), or the whole deck as one page with its notes. */
  view?: "slides" | "scroll";
  /** Also open the presenter's window. */
  presenter?: boolean;
  /** A rehearsal: the presenter's window is opened and starts timing the talk. Nothing advances by itself. */
  rehearse?: boolean;
}

export async function presentDeck(session: EditorSession, host: SlidesHost, from: "start" | "current", options: PresentOptions = {}): Promise<void> {
  const deck = session.deck;
  const start = from === "start" ? 0 : Math.max(0, deck.slides.findIndex((slide) => slide.id === session.state.slideId));
  const imageUrl = (path: string): string | undefined => host.imageUrl(path);
  const finished = await host.willPresent?.(deck);
  let link: PresentSync | null = null;
  let presentation: Presentation | null = null;
  let release: (() => void) | null = null;

  // The presenter's window: opened on the host's terms, else as a browser window. It may be asked for again (the S key) once the presentation is up.
  const openLink = async (): Promise<void> => {
    if (link) return;
    link = host.openPresenter ? await host.openPresenter() : openBroadcastPresenter();
    if (!link) host.notify?.("The presenter view could not be opened. Allow this page to open a window and try again.");
    else presentation?.update({ sync: link });
  };
  if ((options.presenter === true || options.rehearse === true) && options.view !== "scroll") await openLink();

  const fullscreen = host.fillScreen
    ? () => {
        if (release) {
          release();
          release = null;
        } else {
          void host.fillScreen?.(() => (release = null)).then((leave) => (release = leave));
        }
      }
    : undefined;

  presentation = openPresentation({
    deck,
    start,
    imageUrl,
    sync: link,
    // What the person chose in Present options: the colour round a slide on a screen of another shape.
    matte: readMatte(),
    ...(options.view ? { view: options.view } : {}),
    ...(options.rehearse ? { rehearse: true } : {}),
    onPresenter: () => void openLink(),
    // The host's own pages: the ones a deck embeds are read through it, and a link to one opens its panel.
    pages: host,
    ...(fullscreen ? { fullscreen } : {}),
    onClosed: () => {
      finished?.();
      release?.();
      link?.post({ type: "bye" });
      link?.close();
    },
  });
}
