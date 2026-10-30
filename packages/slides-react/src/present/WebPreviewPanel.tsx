// A web page shown over a presentation, beside the slide in the editor. The host draws the page in a view of its own (a native web view)
// and this is what frames it: a calm window over the dimmed slide (the default in a show), a peek at the right side that can be dragged
// wider, or the whole window; a header that stays in the page; a skeleton until the page has loaded (the host's view is put on the screen
// only then); a card for a page that cannot be shown; and the order of the Escape key. The box in the middle is only a place: its
// position is handed to the host as it moves, and the host puts the page there.
//
// Escape takes one step back each time: a menu closes first, the whole window goes back to how it was, and then the page closes and the
// key is the presentation's own again. It is heard in the capture phase and stopped, so the presentation never advances or ends on it.

import { type CSSProperties, type JSX, type MouseEvent, type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { editorOf, focusedNow, giveFocusBack, lastEditorRoot } from "../editor/focus/home.ts";
import type { PreviewMode, WebPreviewHost } from "../editor/web-preview-host.ts";
import { covered } from "../editor/ui/covers.ts";
import { type Anchor, pointAnchor } from "../editor/ui/Popover.tsx";
import { WEB_PREVIEW_WIDTH_KEY, readNumber, writeNumber } from "../editor/ui-prefs.ts";
import { type LinkChoice, LinkMenu, copyLink } from "./link-menu.tsx";
import { useWebPreview } from "./useWebPreview.ts";
import { WebPreviewBar } from "./WebPreviewBar.tsx";
import "./web-preview.css";

const MIN_WIDTH = 280;
const MAX_WIDTH = 960;
const DEFAULT_WIDTH = 480;
/** What an arrow key on the edge moves it by. */
const KEY_STEP = 24;

export interface WebPreviewPanelProps {
  host: WebPreviewHost;
  url: string;
  /** The person closed it (Escape, the scrim, or the button). */
  onClose(): void;
  /** Opens the address in the person's own browser when the preview itself cannot (it never opened). */
  openExternally?(url: string): void;
  /** Opens the address in a tab of the host's app. Left out, the header has no such button. */
  openInTab?(url: string): void;
  /** `show` is over a presentation, where Escape is heard everywhere and the keys stay out of reach of the slides; `editor` is beside the slide. */
  surface?: "show" | "editor";
  /** Where the keys go when it closes: the slide shown, or the editor's slide. */
  returnTo?(): HTMLElement | null;
  /** How it sits when it opens: over the slide in a show, beside it in the editor. */
  initialMode?: PreviewMode;
  /** Asks it to sit another way now (a choice from a menu): applied each time `n` changes. */
  request?: { mode: PreviewMode; n: number };
  /** The person chose how it sits (for a deck to remember). */
  onMode?(mode: PreviewMode): void;
  /** The slide's width over its height: the window over the slide is never wider than that. */
  aspect?: number;
}

export function WebPreviewPanel({ host, url, onClose, openExternally, openInTab, surface = "show", returnTo, initialMode, request, onMode, aspect }: WebPreviewPanelProps): JSX.Element {
  const home: PreviewMode = surface === "show" ? "center" : "side";
  const [mode, setModeNow] = useState<PreviewMode>(request?.mode ?? initialMode ?? home);
  const [width, setWidth] = useState(() => readNumber(WEB_PREVIEW_WIDTH_KEY, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH));
  const [menu, setMenu] = useState<Anchor | null>(null);
  const frame = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  /** Where it was before the whole window, for Escape to go back to. */
  const before = useRef<PreviewMode>(mode === "full" ? home : mode);
  const latest = useRef({ mode, onClose, width, onMode });
  latest.current = { mode, onClose, width, onMode };

  const setMode = useCallback((next: PreviewMode): void => {
    const now = latest.current.mode;
    if (next === now) return;
    if (next === "full") before.current = now;
    setModeNow(next);
    latest.current.onMode?.(next);
  }, []);
  // The whole window goes back to how it was.
  const leaveFull = useCallback((): void => setMode(before.current === "full" ? home : before.current), [setMode, home]);
  const choose = useCallback((next: PreviewMode): void => (next === "full" && latest.current.mode === "full" ? leaveFull() : setMode(next)), [setMode, leaveFull]);

  // A menu asked for another way (the same address, or another one in the same view).
  const asked = useRef(request?.n);
  useEffect(() => {
    if (!request || request.n === asked.current) return;
    asked.current = request.n;
    setMode(request.mode);
  }, [request, setMode]);

  // One step back for each Escape: out of the whole window to where it was; beside the editor's slide out of the middle to the side; then closed.
  const escape = useCallback((): void => {
    const now = latest.current.mode;
    if (now === "full") leaveFull();
    else if (surface === "editor" && now === "center") setMode("side");
    else latest.current.onClose();
  }, [leaveFull, setMode, surface]);
  const preview = useWebPreview({ host, url, box, mode, layoutKey: `${mode}:${width}`, onKey: escape });
  const { phase, state } = preview;

  // It has the keys while it is open, and gives them back where they were when it goes (after it is off the page, or the focus is still on it).
  const focusBefore = useRef<HTMLElement | null>(null);
  const back = useRef(returnTo);
  back.current = returnTo;
  useLayoutEffect(() => {
    focusBefore.current = focusedNow();
    frame.current?.focus({ preventScroll: true });
  }, []);
  useEffect(
    () => () => {
      const target = back.current?.() ?? focusBefore.current;
      giveFocusBack(target, editorOf(target) ?? lastEditorRoot());
    },
    [],
  );

  const resize = useCallback((next: number, keep = true): void => {
    const clamped = Math.min(Math.max(Math.round(next), MIN_WIDTH), Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 80)));
    setWidth(clamped);
    if (keep) writeNumber(WEB_PREVIEW_WIDTH_KEY, clamped);
  }, []);

  // The keys. Escape is the panel's from anywhere over a presentation, and from inside it beside the slide. Over a presentation a key in the
  // panel stays in the panel, and a key anywhere else is the slide's only while the panel is at the side and the slide can be seen.
  // A menu of the page that is open has every key, Escape included.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (covered()) return;
      const panel = frame.current;
      const inside = panel !== null && event.target instanceof Node && panel.contains(event.target);
      if (event.key === "Escape") {
        if (surface === "editor" && !inside) return;
        event.preventDefault();
        event.stopPropagation();
        escape();
        return;
      }
      if (inside && event.target instanceof HTMLElement && event.target.dataset.grip !== undefined) {
        const step = event.key === "ArrowLeft" ? KEY_STEP : event.key === "ArrowRight" ? -KEY_STEP : 0;
        if (step !== 0) resize(latest.current.width + step);
        else if (event.key === "Home") resize(MAX_WIDTH);
        else if (event.key === "End") resize(MIN_WIDTH);
        if (step !== 0 || event.key === "Home" || event.key === "End") {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (surface !== "show" || event.key === "Tab") return;
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (inside || (latest.current.mode !== "side" && plain)) event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [surface, escape, resize]);

  // The edge is dragged with the pointer: the panel is at the right, so moving it left makes it wider.
  const drag = useRef<{ x: number; width: number } | null>(null);
  const onGripDown = (event: PointerEvent<HTMLDivElement>): void => {
    drag.current = { x: event.clientX, width: latest.current.width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onGripMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current) resize(drag.current.width + (drag.current.x - event.clientX), false);
  };
  const onGripUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    writeNumber(WEB_PREVIEW_WIDTH_KEY, latest.current.width);
  };

  const address = state?.url ?? url;
  const failed = state?.status === "failed" || state?.status === "blocked";
  const open = (): void => {
    const handle = preview.handle();
    if (handle) handle.openExternal();
    else openExternally?.(address);
  };
  const toTab = openInTab
    ? () => {
        openInTab(address);
        latest.current.onClose();
      }
    : undefined;
  const picked = (choice: LinkChoice): void => {
    if (choice === "here") setMode("center");
    else if (choice === "side") setMode("side");
    else if (choice === "full") setMode("full");
    else if (choice === "tab") toTab?.();
    else if (choice === "browser") open();
    else copyLink(address);
  };
  const onMenu = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    setMenu(pointAnchor(event.clientX, event.clientY));
  };
  const loading = phase === "opening" || (phase === "ready" && !preview.loaded && !failed);
  const style = { ...(mode === "side" ? { width } : {}), ...(aspect ? { "--ks-wp-aspect": aspect } : {}) } as CSSProperties;

  return (
    <>
      {mode === "center" ? <div className="ks-wp-scrim" aria-hidden="true" onClick={() => latest.current.onClose()} /> : null}
      <aside ref={frame} className="ks-wp" data-mode={mode} data-surface={surface} data-phase={phase} role="dialog" aria-label="Web page preview" aria-modal="false" tabIndex={-1} style={style}>
        {mode === "side" ? (
          <div
            className="ks-wp-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the web page preview"
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={MAX_WIDTH}
            aria-valuenow={width}
            tabIndex={0}
            data-grip=""
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
          />
        ) : null}
        <WebPreviewBar
          address={address}
          state={state}
          ready={phase === "ready"}
          loading={loading}
          mode={mode}
          onMode={choose}
          onTab={toTab}
          onBack={() => preview.handle()?.back()}
          onForward={() => preview.handle()?.forward()}
          onReload={() => preview.handle()?.reload()}
          onBrowser={open}
          onClose={() => latest.current.onClose()}
          onMenu={onMenu}
        />
        <div ref={box} className="ks-wp-view" data-failed={failed || undefined}>
          {loading ? (
            <div className="ks-wp-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : null}
          {phase === "unavailable" ? (
            <div className="ks-wp-card" role="status">
              <p className="ks-wp-card-text">Web pages can't be previewed here: web previews are switched off, or this app has no room for one.</p>
              <div className="ks-wp-card-actions">
                {host.turnOn ? (
                  <button type="button" className="ks-wp-card-btn" onClick={() => host.turnOn?.()}>
                    Turn on web previews
                  </button>
                ) : null}
                <button type="button" className="ks-wp-card-btn" onClick={open}>
                  Open in my browser
                </button>
              </div>
            </div>
          ) : null}
          {failed ? (
            <div className="ks-wp-card" role="status">
              <p className="ks-wp-card-text">{state?.message || (state?.status === "blocked" ? "This page can't be shown here: it is blocked." : "This page could not be loaded.")}</p>
              <div className="ks-wp-card-actions">
                <button type="button" className="ks-wp-card-btn" onClick={() => preview.handle()?.reload()}>
                  Try again
                </button>
                <button type="button" className="ks-wp-card-btn" onClick={open}>
                  Open in my browser
                </button>
              </div>
            </div>
          ) : null}
          {loading ? <div className="ks-wp-loading" role="status" aria-label="Loading the page" /> : null}
        </div>
        {menu ? <LinkMenu anchor={menu} onClose={() => setMenu(null)} onChoose={picked} tab={toTab !== undefined} /> : null}
      </aside>
    </>
  );
}
