// Presenting a deck: a window-sized stage, on reveal.js through `@revealjs/react`, that shows the deck's slides one at a
// time with the renderer, at their own size. reveal.js does the moving (keys, steps, backup slides, the overview, the
// black screen, morphs); everything a slide looks like is the renderer's. Nothing is fetched: it all runs offline.

import { Deck as RevealDeck, type DeckProps } from "@revealjs/react";
import type { Deck } from "@kasten-slides/wasm";
import type { RevealApi } from "reveal.js";
import { type CSSProperties, type JSX, type MouseEvent, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

import type { PreviewMode } from "../editor/web-preview-host.ts";
import { type Anchor, anchorOf, pointAnchor } from "../editor/ui/Popover.tsx";
import type { PageAccess } from "../embed/usePageText.ts";
import { type LinkWays, followLink, kindOfLink, linkAt, linkHint, openInWindow } from "../pages/follow.ts";
import type { ImageUrl } from "../render/index.ts";
import { PresentContext } from "./context.ts";
import { DeckTree } from "./DeckTree.tsx";
import { inkExtras } from "./ink/extras.ts";
import { InkTools } from "./ink/InkTools.tsx";
import { InkStore } from "./ink/store.ts";
import { type LinkChoice, LinkMenu, copyLink, isWebPage } from "./link-menu.tsx";
import { createMediaLink } from "./media.ts";
import { PagePanel } from "./PagePanel.tsx";
import { readKeepInk, writeKeepInk } from "./options.ts";
import { readPreviewMode, writePreviewMode } from "./preview-mode.ts";
import { type Matte, matteColor } from "./matte.ts";
import { type Plan, type Position, clampPosition, fromState, planOf, samePosition, spotAt, startPosition } from "./plan.ts";
import { installRevealCss } from "./reveal-css.ts";
import { attachChrome } from "./runtime/chrome.js";
import type { ShowScreens } from "./runtime/chrome.js";
import { revealConfig } from "./runtime/config.js";
import { animateMorph, matchSlides } from "./runtime/morph.js";
import { transitionListener } from "./runtime/transitions.js";
import { ScrollView } from "./ScrollView.tsx";
import { BEAT_MS, imagesOf } from "./show-images.ts";
import { PresentStore } from "./store.ts";
import type { PresentSync } from "./sync.ts";
import { useShowSync } from "./useShowSync.ts";
import { AudioLayer } from "./audio/AudioLayer.tsx";
import { DeckFontStyle } from "../editor/fonts/DeckFonts.tsx";
import { WebPreviewPanel } from "./WebPreviewPanel.tsx";
import "./present.css";

export interface PresentModeProps {
  deck: Deck;
  /** Where to begin: the place of a slide among the deck's slides, hidden ones counted. */
  start: number;
  /** Turns an image path stored in the deck into a URL the page can load. Give a function that stays the same between renders. */
  imageUrl: ImageUrl;
  /** Called when the person leaves (Esc, or the button in the scroll view). */
  onExit(): void;
  /** The link to the presenter's window, if one is open: the two follow each other. */
  sync?: PresentSync | null;
  /** What the S key does. */
  onPresenter?: () => void;
  /** The talk is a rehearsal: the presenter's window is told, with the deck, to start timing it. This window shows nothing of it. */
  rehearse?: boolean;
  /** What the F key does, where the host has a better full screen than the page's own. */
  fullscreen?: () => void;
  /** The slides one at a time (the default), or the deck as one page that scrolls, with its notes. */
  view?: "slides" | "scroll";
  /** The colour round the slide on a screen of another shape than the slide's own: black when left out. The slide itself is always whole and centred. */
  matte?: Matte;
  /** Whether reveal.js's arrows and progress bar show. Off when left out: a show is the slide and nothing else. */
  controls?: boolean;
  /** The mouse toolbar at the bottom left, shown while the pointer moves. Off when left out. */
  toolbar?: boolean;
  /** The displays the show may be on, for the toolbar's menu and the presenter's "Swap screens". Without it the show has no such choice. */
  screens?: ShowScreens;
  /**
   * What the host gives the slides to do with pages of its own: read the pages a deck embeds, open a web address, and show a page
   * in a panel at the side when a link to it is followed. Without it those links do nothing (a web address opens a window).
   */
  pages?: Partial<PageAccess>;
}

export { BEAT_MS, imagesOf };

/** The events of reveal.js that change where the person is. */
const MOVES = ["ready", "slidechanged", "fragmentshown", "fragmenthidden", "overviewshown", "overviewhidden", "paused", "resumed"] as const;

function locator(plan: Plan): (number: number) => [number, number] | null {
  const bySlide = new Map(plan.columns.flatMap((column, h) => column.slides.map((slide, v) => [plan.numbers.get(slide.id) ?? 0, [h, v] as [number, number]] as const)));
  return (number) => bySlide.get(Math.min(Math.max(Math.trunc(number) || 1, 1), plan.count)) ?? null;
}

function SlideShow({ deck, start, imageUrl, onExit, sync, onPresenter, rehearse, fullscreen, matte = "black", controls = false, toolbar = false, screens, pages }: PresentModeProps): JSX.Element {
  const plan = useMemo(() => planOf(deck), [deck]);
  // One store for the whole show: an edit of the deck makes a new plan, and the show stays where it is (kept inside the new plan).
  const [store] = useState(() => new PresentStore(startPosition(plan, start)));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Slides near the one on the screen are drawn a moment after it, so that getting to a slide is never held up by them.
  const around = useDeferredValue(snapshot.position.h);
  const [reveal, setReveal] = useState<RevealApi | null>(null);
  const [started, setStarted] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const applying = useRef(false);
  const since = useRef(Date.now());
  // Ink and videos: each window keeps its own and tells the other what changes (through the link, which may come and go).
  const [ink] = useState(() => {
    const made = new InkStore({
      ink: (event) => latest.current.sync?.post({ type: "ink", ink: event }),
      laser: (at) => latest.current.sync?.post({ type: "pointer", at }),
    });
    made.setKeep(readKeepInk(), true);
    return made;
  });
  const [media] = useState(() => createMediaLink((event) => latest.current.sync?.post({ type: "media", media: event })));
  // Read when used: reveal.js's handlers are made once, and the plan, the store and the link change under them.
  const latest = useRef({ onExit, onPresenter, fullscreen, sync, plan, store, screens, toolbar, ink });
  useEffect(() => {
    latest.current = { onExit, onPresenter, fullscreen, sync, plan, store, screens, toolbar, ink };
  });

  useLayoutEffect(() => installRevealCss(), []);

  // The deck was edited: the plan is new, and the place stays inside it. The ink follows the slide the place is on.
  useEffect(() => {
    const now = store.getSnapshot();
    const kept = clampPosition(plan, now.position);
    if (!samePosition(kept, now.position)) store.set({ ...now, position: kept });
    ink.setSlide(spotAt(plan, kept)?.slide.id ?? null);
  }, [plan, store, ink]);
  // The choice to keep ink is the person's, for the next show too.
  useEffect(() => {
    let kept = ink.getSnapshot().keep;
    return ink.subscribe(() => {
      const now = ink.getSnapshot().keep;
      if (now !== kept) writeKeepInk((kept = now));
    });
  }, [ink]);

  // The links of the slides: to another slide, to a page of the host (a calm panel at the side, which Esc puts away), or out to the web
  // (a peek the host draws at the side, which Esc steps back out of; or the person's own browser where the host has no peek).
  const [panel, setPanel] = useState<{ path: string; section: string | null } | null>(null);
  // The page being previewed, and how it was last asked to sit (`n` counts the asks that named a way, so the panel can follow them).
  const [preview, setPreview] = useState<{ url: string; mode: PreviewMode; n: number } | null>(null);
  const [linkMenu, setLinkMenu] = useState<{ url: string; anchor: Anchor } | null>(null);
  const openOutside = useCallback((address: string) => (pages?.openUrl ? pages.openUrl(address) : openInWindow(address)), [pages]);
  const deckId = deck.id;
  const showPreview = useCallback(
    (address: string, mode?: PreviewMode) => {
      // One thing at the side at a time: the page panel gives way to the preview.
      setPanel(null);
      if (mode) writePreviewMode(deckId, mode);
      setPreview((now) => ({ url: address, mode: mode ?? now?.mode ?? readPreviewMode(deckId), n: (now?.n ?? 0) + (mode ? 1 : 0) }));
    },
    [deckId],
  );
  const ways = useMemo<LinkWays>(
    () => ({
      slide: (id) => {
        const number = plan.numbers.get(id);
        const at = number === undefined ? null : locator(plan)(number);
        if (at && reveal) reveal.slide(at[0], at[1]);
      },
      ...(pages?.pagePanel
        ? {
            page: (path: string, section: string | null) => {
              setPreview(null);
              setPanel({ path, section });
            },
          }
        : {}),
      // A web page opens over the slide; mail, phone and the like go out to the program that handles them.
      web: (address) => (pages?.webPreview && isWebPage(address) ? showPreview(address) : openOutside(address)),
    }),
    [plan, reveal, pages, openOutside, showPreview],
  );
  const choose = useCallback(
    (address: string, choice: LinkChoice) => {
      const way = { here: "center", side: "side", full: "full" } as const;
      if (choice === "here" || choice === "side" || choice === "full") {
        if (pages?.webPreview) showPreview(address, way[choice]);
        else openOutside(address);
      } else if (choice === "tab") (pages?.openInTab ?? openOutside)(address);
      else if (choice === "browser") openOutside(address);
      else copyLink(address);
    },
    [pages, showPreview, openOutside],
  );
  // A right-click on a link to a web page: the six choices, in a menu of the page (the system's is not the app's, and is not on during a show).
  const onContextMenu = (event: MouseEvent): void => {
    const href = linkAt(event.target)?.trim();
    if (!href || !isWebPage(href) || kindOfLink(href) !== "web") return;
    event.preventDefault();
    event.stopPropagation();
    const from = event.target instanceof Element ? event.target.closest("[data-href], [data-link]") : null;
    // A key (the menu key, Shift+F10) sends the event with no pointer: the menu opens at the link.
    const anchor = event.clientX === 0 && event.clientY === 0 && from ? anchorOf(from) : pointAnchor(event.clientX, event.clientY);
    setLinkMenu({ url: href, anchor });
  };
  const follow = useCallback((href: string) => followLink(href, ways), [ways]);
  const context = useMemo(() => ({ pages, onLink: follow, media: media.channel, ink }), [pages, follow, media, ink]);

  // The words that link are reached by Tab too, and say where they go.
  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    for (const node of root.querySelectorAll<HTMLElement>(".ks-text-link[data-href]:not([tabindex])")) {
      // An address that could run is not a link here: it is words.
      if (kindOfLink(node.dataset.href) === null) continue;
      node.tabIndex = 0;
      node.setAttribute("role", "link");
      if (!node.title) node.title = linkHint(node.dataset.href ?? "");
    }
  }, [snapshot.position, deck]);

  // Keys go to the stage, not to whatever had the focus before it.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    before?.blur();
    stage.current?.focus({ preventScroll: true });
    return () => before?.focus({ preventScroll: true });
  }, []);

  // The pointer goes after 2 s at rest; the arrows and the progress bar are the person's choice (off to begin with).
  // The deck's own choices: go back to the first slide after the last, and move on by itself after some seconds (a kiosk).
  const looped = deck.present.loop === true;
  const seconds = deck.present.autoAdvance ?? 0;
  // (Rust calls the first `looped`, the file and the types `loop`.)
  const config = useMemo(
    () =>
      revealConfig(deck.size, {
        autoAnimateMatcher: matchSlides,
        controls,
        progress: controls,
        hideCursorTime: 2000,
        loop: looped,
        autoSlide: seconds > 0 ? Math.round(seconds * 1000) : 0,
      }) as DeckProps["config"],
    [deck.size.w, deck.size.h, controls, looped, seconds],
  );

  // Once reveal.js is up: follow it, give it the presentation's keys and morphs, and take it to where the person asked to begin.
  const teardown = useRef<(() => void) | null>(null);
  const ready = useCallback((instance: RevealApi) => {
    // The plan and the store are read each time they are used: the deck may be edited, and the plan made again, while the show runs.
    const commit = () => {
      const { plan: current, store: held, ink: drawn } = latest.current;
      const state = instance.getState();
      const next = { position: fromState(current, state), overview: Boolean(state.overview), paused: Boolean(state.paused) };
      // The ink goes with the slide (or waits for it, when it is kept), before the new slide is drawn.
      drawn.setSlide(spotAt(current, next.position)?.slide.id ?? null);
      // In step with reveal.js, before it goes on (a morph measures the slides as they are drawn by then). The time it takes is
      // measured (`ks-present:draw`), for a check that a step or a slide starts to show within 50 ms.
      const began = performance.now();
      flushSync(() => void held.set(next));
      performance.measure("ks-present:draw", { start: began });
      if (!applying.current) latest.current.sync?.post({ type: "state", state });
    };
    for (const type of MOVES) instance.on(type, commit);
    instance.on("autoanimate", animateMorph as unknown as EventListener);
    // The transitions reveal.js has no name for (push, wipe, cover ...) are played from the slide the person arrives on.
    const arrives = transitionListener() as unknown as EventListener;
    instance.on("slidechanged", arrives);
    const chrome = attachChrome(instance, tools.current as HTMLElement, {
      locate: (number) => locator(latest.current.plan)(number),
      extras: inkExtras(latest.current.ink),
      onExit: () => latest.current.onExit(),
      onPresenter: () => latest.current.onPresenter?.(),
      ...(latest.current.fullscreen ? { fullscreen: () => latest.current.fullscreen?.() } : {}),
      ...(stage.current ? { fullscreenTarget: stage.current } : {}),
      toolbar: latest.current.toolbar,
      // Read when used, so a show that gets its screens late (or loses them) is followed.
      ...(latest.current.screens
        ? {
            screens: {
              list: () => latest.current.screens?.list() ?? Promise.resolve([]),
              swap: () => latest.current.screens?.swap(),
              moveTo: (label: string) => latest.current.screens?.moveTo(label),
              identify: () => latest.current.screens?.identify?.(),
            },
          }
        : {}),
    });
    // The pen's button shows pressed while it is in hand; a pen and the laser are not in hand together.
    const shown = latest.current.ink;
    let last: string | null = null;
    const showTool = () => {
      const { tool } = shown.getSnapshot();
      if (tool === last) return;
      last = tool;
      chrome.setPressed("pen", tool === "pen");
      chrome.setPressed("highlighter", tool === "highlighter");
      if (tool) chrome.laser(false);
    };
    const stopTool = shown.subscribe(showTool);
    teardown.current = () => {
      for (const type of MOVES) instance.off(type, commit);
      instance.off("autoanimate", animateMorph as unknown as EventListener);
      instance.off("slidechanged", arrives);
      stopTool();
      chrome.destroy();
    };
    const held = latest.current.store;
    const at: Position = held.getSnapshot().position;
    instance.slide(at.h, at.v, at.f);
    setReveal(instance);
    requestAnimationFrame(() => setStarted(true));
  }, []);
  useEffect(
    () => () => {
      teardown.current?.();
      teardown.current = null;
    },
    [],
  );

  // The presenter's window: the deck when it comes, then where the talk is and what changed in the deck (useShowSync.ts).
  useShowSync({ reveal, sync, deck, imageUrl, rehearse, since, applying, media, ink, latest });

  // The slide is whole and centred at its own proportions whatever the screen is; what is left round it is the matte.
  const bars = useMemo(() => matteColor(deck, matte), [deck.theme, matte]);

  return (
    <div
      ref={stage}
      className={`ks-show${started ? "" : " is-starting"}`}
      role="dialog"
      aria-label={`Presenting ${deck.title}`}
      tabIndex={-1}
      data-paused={snapshot.paused || undefined}
      data-matte={matte}
      style={{ "--ks-show-matte": bars } as CSSProperties}
      onContextMenu={onContextMenu}
      onClick={(event) => {
        const href = linkAt(event.target);
        if (href && follow(href)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== "Enter" || !(event.target instanceof Element)) return;
        const href = event.target.closest<HTMLElement>(".ks-text-link[data-href]")?.dataset.href;
        if (href && follow(href)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <PresentContext.Provider value={context}>
        <RevealDeck className="ks-show-reveal" config={config} onReady={ready}>
          <DeckTree plan={plan} position={snapshot.position} overview={snapshot.overview} around={around} imageUrl={imageUrl} />
        </RevealDeck>
      </PresentContext.Provider>
      <div ref={tools} className="ks-show-chrome" />
      <InkTools store={ink} />
      <AudioLayer plan={plan} position={snapshot.position} imageUrl={imageUrl} />
      <DeckFontStyle fonts={deck.present.fonts} imageUrl={imageUrl} />
      {panel && pages?.pagePanel ? (
        <PagePanel
          Panel={pages.pagePanel}
          path={panel.path}
          section={panel.section}
          onClose={() => {
            setPanel(null);
            stage.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
      {preview && pages?.webPreview ? (
        <WebPreviewPanel
          host={pages.webPreview}
          url={preview.url}
          surface="show"
          initialMode={preview.mode}
          request={{ mode: preview.mode, n: preview.n }}
          onMode={(mode) => writePreviewMode(deckId, mode)}
          aspect={deck.size.w / deck.size.h}
          onClose={() => setPreview(null)}
          openExternally={openOutside}
          {...(pages.openInTab ? { openInTab: pages.openInTab } : {})}
          returnTo={() => stage.current}
        />
      ) : null}
      {linkMenu ? (
        <LinkMenu
          anchor={linkMenu.anchor}
          previews={Boolean(pages?.webPreview)}
          tab={Boolean(pages?.openInTab)}
          onClose={() => setLinkMenu(null)}
          onChoose={(choice) => choose(linkMenu.url, choice)}
        />
      ) : null}
    </div>
  );
}

/** The presentation, over the whole window. */
export function PresentMode(props: PresentModeProps): JSX.Element {
  return props.view === "scroll" ? <ScrollView deck={props.deck} imageUrl={props.imageUrl} onExit={props.onExit} /> : <SlideShow {...props} />;
}
