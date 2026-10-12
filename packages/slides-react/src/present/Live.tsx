// The live part of a slide: an embedded page runs in a frame over its box, a video plays in place of its
// still. Both are on top of what the slide draws for them (their poster or panel), so when a page cannot be
// reached or a video cannot be played the slide still shows that, and never a broken frame.
//
// A page is laid out at the size of a window of its own (Desktop 1280 by 800, say) and scaled into the box, so it keeps its own
// layout whatever the box. A page of the host (a Kasten page) is drawn the same way from its words, with no frame at all. Both are
// looked at from a distance until the person clicks one to use it (the keys then go to the page, Esc takes them back).

import type { Deck, Element, Slide, Theme } from "@kasten-slides/wasm";
import { type CSSProperties, type JSX, useContext, useEffect, useMemo, useRef, useState } from "react";

import { EmbedBox, stageStyle } from "../embed/EmbedBox.tsx";
import { EmbedChip } from "../embed/EmbedChip.tsx";
import { isPageEmbedElement } from "../embed/kinds.ts";
import { PageView } from "../embed/PageView.tsx";
import { PAGE_DESIGN } from "../embed/scale.ts";
import { useEmbedControl } from "../embed/useEmbedControl.ts";
import { type PageAccess, usePageText } from "../embed/usePageText.ts";
import { stateAt } from "../render/index.ts";
import type { ImageUrl } from "../render/index.ts";
import { type Box, boxOf } from "../theme/index.ts";
import { PresentContext } from "./context.ts";
import { EMBED_SECONDS, answers, embedSandbox, embedUrl } from "./live-url.ts";

type Embed = Extract<Element, { type: "embed" }>;
type Video = Extract<Element, { type: "video" }>;

interface Item {
  element: Embed | Video;
  box: Box;
  opacity: number;
}

/** The embeds and videos a slide shows at a step: not the ones a step hides, nor those in a group it hides. */
export function liveItems(deck: Deck, slide: Slide, step: number): Item[] {
  const found: Item[] = [];
  const walk = (elements: readonly Element[], hidden: boolean): void => {
    for (const element of elements) {
      const state = stateAt(element, step);
      if (element.type === "group") {
        walk(element.children, hidden || state === "hidden");
      } else if ((element.type === "embed" || element.type === "video") && !hidden && state !== "hidden") {
        const box = boxOf(deck.theme, slide.layout, element);
        if (box) found.push({ element, box, opacity: (element.style?.opacity ?? 1) * (state === "dimmed" ? deck.theme.dimmedOpacity : 1) });
      }
    }
  };
  walk(slide.elements, false);
  return found;
}

/** Whether an embed shows a page of the host: it has no web address of its own, and says which page. */
export const isPageEmbed = isPageEmbedElement;

function place({ box, element, opacity }: Item, extra: CSSProperties = {}): CSSProperties {
  const turn = element.rotation ? `rotate(${element.rotation}deg)` : undefined;
  return { position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, ...(turn ? { transform: turn } : {}), ...(opacity < 1 ? { opacity } : {}), ...extra };
}

export interface EmbedFrameProps {
  item: Item & { element: Embed };
  /** Seconds a page has to load. */
  seconds?: number;
  /** Asks whether an address answers; the browser's fetch when left out, and no question when null. */
  ask?: typeof fetch | null;
  /** What a page of the host is read and followed with. Without it an embedded page is drawn from the words the deck kept. */
  pages?: Partial<PageAccess> | undefined;
  theme?: Theme | undefined;
  imageUrl?: ImageUrl | undefined;
  /** A link of an embedded page of the host was followed. */
  onLink?: ((href: string) => void) | undefined;
}

/**
 * An embedded page. It is see-through until it has loaded and the address has answered, and it goes away (so the slide's own
 * poster or panel shows) if the address does not answer or the page has not loaded in time.
 */
export function EmbedFrame(props: EmbedFrameProps): JSX.Element | null {
  return isPageEmbed(props.item.element) ? <PageEmbed {...props} /> : <WebEmbed {...props} />;
}

/** A cover over a page that is looked at, which hands it the pointer when clicked. */
function Cover({ title, onActivate }: { title: string; onActivate(): void }): JSX.Element {
  return (
    <button type="button" className="ks-embed-cover" aria-label={`Use ${title}. Press Escape to go back to the slide.`} onClick={onActivate}>
      <span>Click to interact</span>
    </button>
  );
}

function WebEmbed({ item, seconds = EMBED_SECONDS, ask }: EmbedFrameProps): JSX.Element | null {
  const url = embedUrl(item.element.url);
  const [loaded, setLoaded] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [late, setLate] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const control = useEmbedControl(item.box, item.element);
  const title = item.element.title || item.element.alt || "Embedded page";

  useEffect(() => {
    if (!url) return;
    let live = true;
    const timer = setTimeout(() => live && setLate(true), seconds * 1000);
    void answers(url, ask).then((yes) => live && setReachable(yes));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [url, seconds, ask]);

  // A page that refuses the connection still "loads" its error page, so the question of whether it answers has the last word.
  const ready = loaded && reachable === true;
  if (!url || reachable === false || (late && !ready)) return null;
  return (
    <div
      className="ks-show-live-item"
      data-active={control.active || undefined}
      style={place(item, { pointerEvents: ready ? "auto" : "none" })}
      // The keys go to the deck again once the pointer is off the page.
      onPointerLeave={() => {
        if (frame.current && document.activeElement === frame.current) {
          frame.current.blur();
          window.focus();
        }
        control.setActive(false);
      }}
    >
      <div className="ks-embed-box">
        <div className="ks-embed-stage" style={stageStyle(control.frame)}>
          <iframe
            ref={frame}
            className="ks-show-live-frame"
            src={url}
            title={title}
            sandbox={embedSandbox(url)}
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            style={{ opacity: ready ? 1 : 0 }}
          />
        </div>
      </div>
      {ready && !control.active ? <Cover title={title} onActivate={() => control.setActive(true)} /> : null}
      {ready && control.active ? <EmbedChip scale={control.frame.scale} fitted={control.fitted} onStep={control.step} onFit={control.fit} onDone={() => control.setActive(false)} /> : null}
    </div>
  );
}

function PageEmbed({ item, pages, theme, imageUrl, onLink }: EmbedFrameProps): JSX.Element | null {
  const { element } = item;
  const control = useEmbedControl(item.box, element, PAGE_DESIGN);
  const { markdown, missing } = usePageText(pages, element.source);
  if (!theme) return null;
  const title = element.title || element.source?.title || "Embedded page";
  return (
    <div className="ks-show-live-item" data-active={control.active || undefined} data-page={element.source?.page} style={place(item, { pointerEvents: "auto" })} onPointerLeave={() => control.setActive(false)}>
      <EmbedBox box={item.box} view={control.view}>
        <PageView markdown={markdown} theme={theme} imageUrl={imageUrl} scroll={control.active} onLink={control.active ? onLink : undefined} />
        {missing ? <p className="ks-pv-missing">This page is not in the vault any more. This is how it read.</p> : null}
      </EmbedBox>
      {control.active ? (
        <EmbedChip scale={control.frame.scale} fitted={control.fitted} onStep={control.step} onFit={control.fit} onDone={() => control.setActive(false)} />
      ) : (
        <Cover title={title} onActivate={() => control.setActive(true)} />
      )}
    </div>
  );
}

export interface VideoPlayerProps {
  item: Item & { element: Video };
  imageUrl: ImageUrl;
}

/** A video, played in place: its still until it starts, and the still again if the file cannot be played. */
export function VideoPlayer({ item, imageUrl }: VideoPlayerProps): JSX.Element | null {
  const { element } = item;
  const src = element.src ? imageUrl(element.src) : undefined;
  const poster = element.poster ? imageUrl(element.poster) : undefined;
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const node = video.current;
    if (!element.autoplay || !node) return;
    // A browser may refuse sound before the first touch; then it plays without.
    void node.play().catch(() => {
      node.muted = true;
      return node.play();
    }).catch(() => {});
  }, [element.autoplay, src]);

  if (!src || failed) return null;
  return (
    <video
      ref={video}
      className="ks-show-live-video"
      src={src}
      poster={poster}
      controls
      playsInline
      preload="metadata"
      loop={element.looped ?? false}
      data-autoplay={element.autoplay ? "" : undefined}
      aria-label={element.alt || element.name || "Video"}
      onError={() => setFailed(true)}
      style={place(item)}
    />
  );
}

export interface LiveLayerProps {
  deck: Deck;
  slide: Slide;
  step: number;
  imageUrl: ImageUrl;
  /** What a page of the host is read and followed with (a presentation is given the host's own). */
  pages?: Partial<PageAccess> | undefined;
  /** A link of an embedded page of the host was followed. */
  onLink?: ((href: string) => void) | undefined;
}

/** The live embeds and videos of a slide, in a layer the size of the slide over it. Nothing when there are none. */
export function LiveLayer({ deck, slide, step, imageUrl, pages: given, onLink: followed }: LiveLayerProps): JSX.Element | null {
  const items = useMemo(() => liveItems(deck, slide, step), [deck, slide, step]);
  const around = useContext(PresentContext);
  const pages = given ?? around.pages;
  const onLink = followed ?? around.onLink;
  if (items.length === 0) return null;
  return (
    <div className="ks-show-live" style={{ width: deck.size.w, height: deck.size.h }}>
      {items.map((item) =>
        item.element.type === "embed" ? (
          <EmbedFrame key={item.element.id} item={{ ...item, element: item.element }} pages={pages} theme={deck.theme} imageUrl={imageUrl} onLink={onLink} />
        ) : (
          <VideoPlayer key={item.element.id} item={{ ...item, element: item.element }} imageUrl={imageUrl} />
        ),
      )}
    </div>
  );
}
