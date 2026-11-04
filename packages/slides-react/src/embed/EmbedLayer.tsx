// What the editor shows of the embeds of a slide, over the slide in its own units. A page of the host is live (its words, read-only,
// as the page reads now), since it costs the editor nothing. A web page is live only while it is the selected element: every other
// embed is the snapshot or the panel the slide itself draws, so a slide of many embeds stays light and nothing off the slide runs.
// Nothing here takes the pointer, except an embed that is playing: the slide's own gestures select, move and resize the embed,
// whatever is drawn in it. In the desktop app a web page is a picture until Play is pressed on the selected embed; Esc ends it.

import type { Deck, Slide } from "@kasten-slides/wasm";
import { type CSSProperties, type JSX, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { SlidesHost } from "../editor/host.ts";
import { openPreview } from "../editor/preview/preview-store.ts";
import { openInWindow } from "../pages/follow.ts";
import { EmbedBox } from "./EmbedBox.tsx";
import { EmbedChip } from "./EmbedChip.tsx";
import { type FramePolicy, useFrameRefused } from "./frame-policy.ts";
import { PageView } from "./PageView.tsx";
import { PAGE_DESIGN, DEFAULT_DESIGN, viewOf } from "./scale.ts";
import { isPageEmbedElement } from "./kinds.ts";
import { startPlaying, stopPlaying, usePlayingEmbed } from "./play-store.ts";
import { FrameCard } from "../present/FrameCard.tsx";
import { liveItems } from "../present/live-items.ts";
import { EMBED_ALLOW, EMBED_REFERRER, type EmbedFields, embedSandbox, embedUrl, frameAddress } from "../present/live-url.ts";
import { type FrameStatus, watchFrame } from "../present/web-frame.ts";
import { usePageText } from "./usePageText.ts";
import { scaleOfSelected, selectedEmbed, zoomSelectedEmbed } from "./zoom.ts";
import { zoomWheelOf } from "./zoom-keys.ts";
import type { EditorSession } from "../editor/session/session.ts";

export interface EmbedLayerProps {
  deck: Deck;
  slide: Slide;
  /** The step shown on the canvas; undefined shows the slide as it is styled. */
  step: number | undefined;
  /** The ids selected. */
  selection: readonly string[];
  host: SlidesHost;
  imageUrl: (path: string) => string | undefined;
}

const placed = (box: { x: number; y: number; w: number; h: number }, rotation: number | null | undefined, opacity: number): CSSProperties => ({
  position: "absolute",
  left: box.x,
  top: box.y,
  width: box.w,
  height: box.h,
  pointerEvents: "none",
  ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
  ...(opacity < 1 ? { opacity } : {}),
});

/**
 * A web page or a video in the editor: loaded once it is selected (where the host lets the editor frame), or once Play was pressed on
 * it (where the host must permit frames first), and seen only when it has loaded; the slide's own snapshot shows until then. A page
 * that is refused, slow or offline gets a card of words that says so; the chip over the selection has the buttons (Play, Preview
 * live, Open externally). A page that is playing takes the pointer and the keys while the pointer is over it.
 */
function WebPage({ element, title, box, view, playing, policy }: { element: EmbedFields; title: string; box: { w: number; h: number }; view: ReturnType<typeof viewOf>; playing: boolean; policy: FramePolicy | undefined }): JSX.Element | null {
  // What is played starts at once, when it is a video.
  const framed = frameAddress(playing ? { ...element, autoplay: true } : element);
  const url = framed?.url ?? null;
  const video = framed?.link.kind === "video";
  const [status, setStatus] = useState<FrameStatus>("loading");
  const frame = useRef<HTMLIFrameElement>(null);
  const refused = useFrameRefused(policy, framed?.link ?? null, embedUrl(element.url));
  // The frame is given its address after the watch is on it, so a refusal is never missed.
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node || !url) return;
    if (refused) {
      if (node.getAttribute("src")) node.src = "about:blank";
      setStatus("refused");
      return;
    }
    setStatus("loading");
    return watchFrame(node, url, { onChange: setStatus });
  }, [url, refused]);
  if (!url) return null;
  return (
    <>
      <EmbedBox box={box} view={video ? { design: { w: box.w, h: box.h }, zoom: null, fit: "page" } : view}>
        <iframe
          ref={frame}
          title={title}
          sandbox={embedSandbox(url)}
          referrerPolicy={EMBED_REFERRER}
          allow={EMBED_ALLOW}
          allowFullScreen
          tabIndex={playing ? 0 : -1}
          style={{ opacity: status === "ready" ? 1 : 0 }}
          // The keys go back to the editor once the pointer is off the page (Esc is then the editor's: it stops the playing).
          onPointerLeave={playing ? () => {
            if (frame.current && document.activeElement === frame.current) {
              frame.current.blur();
              window.focus();
            }
          } : undefined}
        />
      </EmbedBox>
      <FrameCard status={status} />
    </>
  );
}

function PagePart({ item, deck, host, imageUrl }: { item: ReturnType<typeof liveItems>[number]; deck: Deck; host: SlidesHost; imageUrl: EmbedLayerProps["imageUrl"] }): JSX.Element | null {
  const element = item.element;
  const { markdown, missing } = usePageText(host, element.type === "embed" ? element.source : null);
  if (element.type !== "embed") return null;
  return (
    <EmbedBox box={item.box} view={viewOf(element, PAGE_DESIGN)}>
      <PageView markdown={markdown} theme={deck.theme} imageUrl={imageUrl} />
      {missing ? <p className="ks-pv-missing">This page is not in the vault any more. This is how it read.</p> : null}
    </EmbedBox>
  );
}

/** Whether the editor frames a selected web page by itself: not where the host must permit frames first (it then plays on request), nor where it has a peek of its own. */
const framesByItself = (host: SlidesHost): boolean => host.willPresent === undefined && host.webPreview === undefined;

/** Whether a web page of the editor can be played on request: the host permits frames, and the editor does not frame by itself. */
export const canPlay = (host: SlidesHost): boolean => !framesByItself(host) && host.allowFrames !== undefined;

export function EmbedLayer({ deck, slide, step, selection, host, imageUrl }: EmbedLayerProps): JSX.Element | null {
  const playing = usePlayingEmbed();
  const items = liveItems(deck, slide, step ?? -1).filter((item) => item.element.type === "embed");
  const shown = items.filter((item) => {
    const { element } = item;
    if (element.type !== "embed") return false;
    if (isPageEmbedElement(element)) return true;
    if (selection.length !== 1 || selection[0] !== element.id || embedUrl(element.url) === null) return false;
    // A host that has to permit the frames a deck embeds (the desktop app, which does it for a presentation) shows the snapshot here until
    // Play is pressed, and so does one that has a web preview of its own (a native view, drawn by the host): no frame of the editor's own then.
    return framesByItself(host) || playing === element.id;
  });
  const playingShown = playing !== null && shown.some((item) => item.element.id === playing);

  // A playing embed ends when it is no longer there to play (another selection, another slide, a step that hides it), and with Esc.
  useEffect(() => {
    if (playing !== null && !playingShown) stopPlaying();
  }, [playing, playingShown]);
  useEffect(() => {
    if (!playingShown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      stopPlaying();
    };
    // Before the editor's own keys: Esc ends the playing, and the next Esc is the editor's.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [playingShown]);
  useEffect(() => () => stopPlaying(), []);

  if (shown.length === 0) return null;
  return (
    <div className="ks-embed-layer" aria-hidden={playingShown ? undefined : "true"} style={{ position: "absolute", left: 0, top: 0, width: deck.size.w, height: deck.size.h, pointerEvents: "none" }}>
      {shown.map((item) => {
        const { element } = item;
        if (element.type !== "embed") return null;
        const live = playing === element.id;
        return (
          <div key={element.id} className="ks-embed-live" data-embed={element.id} data-playing={live || undefined} style={{ ...placed(item.box, element.rotation, item.opacity), ...(live ? { pointerEvents: "auto" as const } : {}) }}>
            {isPageEmbedElement(element) ? (
              <PagePart item={item} deck={deck} host={host} imageUrl={imageUrl} />
            ) : (
              <WebPage element={element} title={element.title || "Embedded page"} box={item.box} view={viewOf(element, DEFAULT_DESIGN)} playing={live} policy={host.framePolicy} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The zoom of the selected embed's page: a chip over the corner of its box (how far it is zoomed, a step down and up, Fit), and
 * Ctrl with the wheel over the box, which zoom the page and not the slide.
 */
export function EmbedControls({ session, zoom, page }: { session: EditorSession; zoom: number; page: RefObject<HTMLElement | null> }): JSX.Element | null {
  const found = selectedEmbed(session);
  const id = found?.element.id ?? null;
  // Which embed plays now (the chip shows Stop for it).
  const playing = usePlayingEmbed();

  useEffect(() => {
    const element = page.current;
    if (!element || id === null) return;
    const onWheel = (event: WheelEvent) => {
      const word = zoomWheelOf(event);
      const now = selectedEmbed(session);
      if (word === null || !now) return;
      const at = element.getBoundingClientRect();
      const x = (event.clientX - at.left) / zoom;
      const y = (event.clientY - at.top) / zoom;
      const { box } = now;
      if (x < box.x || y < box.y || x > box.x + box.w || y > box.y + box.h) return;
      // The page, not the slide: the stage's own wheel listener, which sits above this one, never hears of it.
      event.preventDefault();
      event.stopPropagation();
      zoomSelectedEmbed(session, word);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [session, page, zoom, id]);

  if (!found || found.element.locked) return null;
  const { box } = found;
  // A web page can be played in the editor, previewed live beside the slide, or opened outside; a page of the host is already live and has nowhere else to open.
  const address = isPageEmbedElement(found.element) ? null : embedUrl(found.element.url);
  const playable = address !== null && canPlay(session.host);
  const embedId = found.element.id;
  return (
    <div data-selbar="" className="ks-embed-controls" style={{ position: "absolute", left: box.x * zoom, top: box.y * zoom, width: box.w * zoom, height: 0, pointerEvents: "none" }}>
      <EmbedChip
        scale={scaleOfSelected(found)}
        fitted={found.view.zoom === null}
        onStep={(direction) => void zoomSelectedEmbed(session, direction > 0 ? "in" : "out")}
        onFit={() => void zoomSelectedEmbed(session, "fit")}
        onPlay={playable ? () => void (playing === embedId ? stopPlaying() : startPlaying(session.host, embedId, frameAddress(found.element)?.url ?? address)) : undefined}
        playing={playable && playing === embedId}
        onPreview={address ? () => openPreview(session, address) : undefined}
        onOpenOutside={address ? () => (session.host.openUrl ? session.host.openUrl(address) : openInWindow(address)) : undefined}
      />
    </div>
  );
}
