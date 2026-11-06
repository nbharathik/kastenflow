// The live part of a slide: an embedded page runs in a frame over its box, a video plays in place of its
// still. Both are on top of what the slide draws for them (their poster or panel), so when a page cannot be
// reached or a video cannot be played the slide still shows that, and never a broken frame.
//
// A page is laid out at the size of a window of its own (Desktop 1280 by 800, say) and scaled into the box, so it keeps its own
// layout whatever the box. A page of the host (a Kasten page) is drawn the same way from its words, with no frame at all. Both are
// looked at from a distance until the person clicks one to use it (the keys then go to the page, Esc takes them back).

import type { Deck, Slide, Theme } from "@kasten-slides/wasm";
import { type CSSProperties, type JSX, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { EmbedBox, stageStyle } from "../embed/EmbedBox.tsx";
import { EmbedChip } from "../embed/EmbedChip.tsx";
import { useFrameRefused } from "../embed/frame-policy.ts";
import { isPageEmbedElement } from "../embed/kinds.ts";
import { PageView } from "../embed/PageView.tsx";
import { PAGE_DESIGN } from "../embed/scale.ts";
import { useEmbedControl } from "../embed/useEmbedControl.ts";
import { type PageAccess, usePageText } from "../embed/usePageText.ts";
import { openInWindow } from "../pages/follow.ts";
import type { ImageUrl } from "../render/index.ts";
import { PresentContext } from "./context.ts";
import { FrameCard, OpenOutside } from "./FrameCard.tsx";
import { type Embed, type Item, type Video, liveItems } from "./live-items.ts";
import { EMBED_ALLOW, EMBED_REFERRER, embedSandbox, embedUrl, frameAddress } from "./live-url.ts";
import { type MediaAction, type MediaChannel, mediaKey } from "./media.ts";
import { inside, pastEnd, trimOf, volumeOf } from "./video-trim.ts";
import { type FrameStatus, watchFrame } from "./web-frame.ts";

export { liveItems };

/** Whether an embed shows a page of the host: it has no web address of its own, and says which page. */
export const isPageEmbed = isPageEmbedElement;

function place({ box, element, opacity }: Item, extra: CSSProperties = {}): CSSProperties {
  const turn = element.rotation ? `rotate(${element.rotation}deg)` : undefined;
  return { position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, ...(turn ? { transform: turn } : {}), ...(opacity < 1 ? { opacity } : {}), ...extra };
}

export interface EmbedFrameProps {
  item: Item & { element: Embed };
  /** Seconds a page has to load before the card that says it is slow comes over it (the page is kept, and shows if it loads after all). */
  seconds?: number;
  /** What a page of the host is read and followed with. Without it an embedded page is drawn from the words the deck kept. */
  pages?: Partial<PageAccess> | undefined;
  theme?: Theme | undefined;
  imageUrl?: ImageUrl | undefined;
  /** A link of an embedded page of the host was followed. */
  onLink?: ((href: string) => void) | undefined;
  /** The page's video plays without sound and without starting by itself (the presenter's view). */
  muted?: boolean | undefined;
}

/**
 * An embedded page. It is see-through until it has loaded, with the slide's own poster or panel showing through. A page the security
 * policy refuses, that is slow to load, or that cannot load offline gets a card that says so, with a way to open it outside (and
 * to the snapshot when there is one); the page itself is never taken away on a guess.
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

function WebEmbed({ item, seconds, pages, muted }: EmbedFrameProps): JSX.Element | null {
  const framed = frameAddress(muted ? { ...item.element, muted: true, autoplay: false } : item.element);
  const url = framed?.url ?? null;
  // The address the person gave is what opens outside: a watch page, not the player.
  const outside = embedUrl(item.element.url) ?? url;
  // A video plays at once, in a frame that is the box (the player fits itself to it); a page is looked at first.
  const video = framed?.link.kind === "video";
  const [status, setStatus] = useState<FrameStatus>("loading");
  // The person asked for the slide's own snapshot instead of the page.
  const [snapshot, setSnapshot] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const control = useEmbedControl(item.box, item.element);
  const title = item.element.title || item.element.alt || "Embedded page";
  // A site that says in its headers that it will not be framed gets its card at once.
  const refused = useFrameRefused(pages?.framePolicy, framed?.link ?? null, outside);

  // The frame has no address of its own: it is given one once the watch is on it, so a refusal is never missed.
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node || !url || snapshot) return;
    if (refused) {
      // The answer may come after the frame began to load: it is emptied, and the card says why.
      if (node.getAttribute("src")) node.src = "about:blank";
      setStatus("refused");
      return;
    }
    setStatus("loading");
    return watchFrame(node, url, { ...(seconds === undefined ? {} : { seconds }), onChange: setStatus });
  }, [url, seconds, snapshot, refused]);

  if (!url || snapshot) return null;
  const ready = status === "ready";
  const open = (): void => (pages?.openUrl ?? openInWindow)(outside ?? url);
  return (
    <div
      className="ks-show-live-item"
      data-active={control.active || undefined}
      data-frame={status}
      // Until the page shows, the slide under it keeps the pointer; the card and the link out of it take it themselves.
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
        <div className="ks-embed-stage" style={video ? { left: 0, top: 0, width: "100%", height: "100%" } : stageStyle(control.frame)}>
          <iframe
            ref={frame}
            className="ks-show-live-frame"
            title={title}
            sandbox={embedSandbox(url)}
            referrerPolicy={EMBED_REFERRER}
            allow={EMBED_ALLOW}
            allowFullScreen
            style={{ opacity: ready ? 1 : 0 }}
          />
        </div>
      </div>
      <FrameCard status={status} hasSnapshot={Boolean(item.element.poster)} onSnapshot={() => setSnapshot(true)} onOpen={open} />
      {ready && !video && !control.active ? <Cover title={title} onActivate={() => control.setActive(true)} /> : null}
      {ready && !video && control.active ? <EmbedChip scale={control.frame.scale} fitted={control.fitted} onStep={control.step} onFit={control.fit} onDone={() => control.setActive(false)} /> : null}
      {status === "loading" || ready ? <OpenOutside onOpen={open} /> : null}
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
  /** The video is on the screen. Off, it waits ready (loaded, paused, at its place) for the slide that is about to come. */
  active?: boolean;
  /** Where the show remembers the video's place and keeps it in step with the other window. Without it the video is on its own. */
  media?: MediaChannel | undefined;
  /** Which video this is, for `media`. */
  mediaKey?: string;
}

/** A moment after the other window's word, in which this window's own events of the same kind are that word's echo and are not sent back. */
const ECHO_MS = 800;

/**
 * A video, played in place: its still until it starts, and the still again if the file cannot be played. It carries on from where it
 * was left when the slide comes round again, and (with a `media` channel) plays, pauses and seeks together with the same video in the
 * other window.
 */
export function VideoPlayer({ item, imageUrl, active = true, media, mediaKey: key }: VideoPlayerProps): JSX.Element | null {
  const { element } = item;
  const src = element.src ? imageUrl(element.src) : undefined;
  const poster = element.poster ? imageUrl(element.poster) : undefined;
  const captions = element.captions ? imageUrl(element.captions) : undefined;
  const trim = trimOf(element);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // How loud it plays is the deck's choice; the presenter's copy stays silent whatever it says.
  useEffect(() => {
    if (video.current) video.current.volume = volumeOf(element.volume);
  }, [element.volume, src]);
  // What this window has just done because the other asked, or because the slide went away: its event is not an act of the person.
  const echoes = useRef(new Set<MediaAction>());
  const quiet = useRef(false);
  const remember = (node: HTMLVideoElement): void => {
    if (media && key && !node.ended) media.memory.set(key, node.currentTime);
  };
  const note = (action: MediaAction): void => {
    echoes.current.add(action);
    setTimeout(() => echoes.current.delete(action), ECHO_MS);
  };
  const tell = (action: MediaAction): void => {
    const node = video.current;
    if (!node || !media || !key) return;
    if (echoes.current.delete(action)) return;
    if (action === "pause" && (quiet.current || node.ended)) return;
    media.send({ key, action, time: node.currentTime });
  };

  // It starts by itself when the slide is on the screen; when the slide goes it stops and keeps its place.
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    if (!active) {
      if (!node.paused) {
        quiet.current = true;
        node.pause();
      }
      remember(node);
      return;
    }
    quiet.current = false;
    if (!element.autoplay) return;
    // A browser may refuse sound before the first touch; then it plays without.
    void node.play().catch(() => {
      node.muted = true;
      return node.play();
    }).catch(() => {});
  }, [active, element.autoplay, src]);
  // The place is kept when the video leaves the page altogether (its slide is far away, and not drawn).
  useEffect(() => {
    // The element is read now: by the time this is undone the ref is empty.
    const node = video.current;
    return () => {
      if (node) remember(node);
    };
  }, []);

  // What the other window's video did, done here.
  useEffect(() => {
    if (!media || !key) return;
    return media.subscribe((event) => {
      const node = video.current;
      if (!node || event.key !== key) return;
      if (Math.abs(node.currentTime - event.time) > 0.5) {
        note("seek");
        node.currentTime = event.time;
      }
      if (event.action === "play" && node.paused) {
        note("play");
        void node.play().catch(() => {});
      } else if (event.action === "pause" && !node.paused) {
        note("pause");
        node.pause();
      }
    });
  }, [media, key]);

  if (!src || failed) return null;
  return (
    <video
      ref={video}
      className="ks-show-live-video"
      src={src}
      poster={poster}
      controls
      playsInline
      muted={media?.muted ?? false}
      preload={active ? "metadata" : "auto"}
      loop={(element.looped ?? false) && trim.end === null && trim.start === 0}
      data-autoplay={element.autoplay ? "" : undefined}
      aria-label={element.alt || element.name || "Video"}
      onError={() => setFailed(true)}
      onLoadedMetadata={(event) => {
        const wanted = media && key ? media.memory.get(key) : 0;
        const node = event.currentTarget;
        node.volume = volumeOf(element.volume);
        if (wanted > 0 && wanted < node.duration - 0.5) {
          // Picking the place up again is not the person seeking.
          note("seek");
          node.currentTime = inside(trim, wanted);
        } else if (trim.start > 0) {
          note("seek");
          node.currentTime = trim.start;
        }
      }}
      onTimeUpdate={(event) => {
        const node = event.currentTarget;
        // A trimmed video stops at its end, or goes back to its start and plays again when it loops.
        if (pastEnd(trim, node.currentTime)) {
          if (element.looped) {
            note("seek");
            node.currentTime = trim.start;
          } else {
            note("pause");
            node.pause();
            node.currentTime = trim.end ?? node.currentTime;
          }
        }
        remember(node);
      }}
      onEnded={() => media && key && media.memory.forget(key)}
      onPlay={() => tell("play")}
      onPause={() => tell("pause")}
      onSeeked={() => tell("seek")}
      style={place(item)}
    >
      {captions ? <track kind="captions" src={captions} label="Captions" default /> : null}
    </video>
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
  /** The videos' memory and their link to the other window; the show's own when left out. */
  media?: MediaChannel | undefined;
  /** The slide is only being got ready for the screen: its videos are loaded and wait, paused; nothing else is shown. */
  ready?: boolean;
}

/** The live embeds and videos of a slide, in a layer the size of the slide over it. Nothing when there are none. */
export function LiveLayer({ deck, slide, step, imageUrl, pages: given, onLink: followed, media: lent, ready = false }: LiveLayerProps): JSX.Element | null {
  const items = useMemo(() => liveItems(deck, slide, step), [deck, slide, step]);
  const around = useContext(PresentContext);
  const pages = given ?? around.pages;
  const onLink = followed ?? around.onLink;
  const media = lent ?? around.media;
  const shown = ready ? items.filter((item) => item.element.type === "video") : items;
  if (shown.length === 0) return null;
  return (
    <div className="ks-show-live" style={{ width: deck.size.w, height: deck.size.h }}>
      {shown.map((item) =>
        item.element.type === "embed" ? (
          <EmbedFrame key={item.element.id} item={{ ...item, element: item.element }} pages={pages} theme={deck.theme} imageUrl={imageUrl} onLink={onLink} muted={media?.muted} />
        ) : (
          <VideoPlayer key={item.element.id} item={{ ...item, element: item.element }} imageUrl={imageUrl} active={!ready} media={media} mediaKey={mediaKey(slide.id, item.element.id)} />
        ),
      )}
    </div>
  );
}
