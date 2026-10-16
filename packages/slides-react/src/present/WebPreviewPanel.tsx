// A web page shown beside the slide, or over a presentation. The host draws the page in a view of its own (a native web view) and this
// is what frames it: a peek at the right side that can be dragged wider, a peek in the middle, or the whole window; a toolbar of named
// icon buttons; a card for a page that cannot be shown; and the order of the Escape key. The box in the middle is only a place: its
// position is handed to the host as it moves, and the host puts the page there.
//
// Escape takes one step back each time: from the whole window or the middle to the side, from the side to closed, and from closed the
// key is the presentation's own again. It is heard in the capture phase and stopped, so the presentation never advances or ends on it.

import { type JSX, type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { editorOf, focusedNow, giveFocusBack, lastEditorRoot } from "../editor/focus/home.ts";
import type { PreviewMode, WebPreviewHost } from "../editor/web-preview-host.ts";
import { Icon, type IconName } from "../editor/ui/Icon.tsx";
import { WEB_PREVIEW_WIDTH_KEY, readNumber, writeNumber } from "../editor/ui-prefs.ts";
import { useWebPreview } from "./useWebPreview.ts";
import "./web-preview.css";

const MIN_WIDTH = 280;
const MAX_WIDTH = 960;
const DEFAULT_WIDTH = 480;
/** What an arrow key on the edge moves it by. */
const KEY_STEP = 24;

export interface WebPreviewPanelProps {
  host: WebPreviewHost;
  url: string;
  /** The person closed it (Escape from the side, or the button). */
  onClose(): void;
  /** Opens the address in the person's own browser when the preview itself cannot (it never opened). */
  openExternally?(url: string): void;
  /** `show` is over a presentation, where Escape is heard everywhere and the keys stay out of reach of the slides; `editor` is beside the slide. */
  surface?: "show" | "editor";
  /** Where the keys go when it closes: the slide shown, or the editor's slide. */
  returnTo?(): HTMLElement | null;
}

function IconBtn({ icon, label, onClick, disabled, pressed }: { icon: IconName; label: string; onClick(): void; disabled?: boolean | undefined; pressed?: boolean | undefined }): JSX.Element {
  return (
    <button type="button" className="ks-wp-btn" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={16} />
    </button>
  );
}

export function WebPreviewPanel({ host, url, onClose, openExternally, surface = "show", returnTo }: WebPreviewPanelProps): JSX.Element {
  const [mode, setMode] = useState<PreviewMode>("side");
  const [width, setWidth] = useState(() => readNumber(WEB_PREVIEW_WIDTH_KEY, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH));
  const frame = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ mode, onClose, width });
  latest.current = { mode, onClose, width };

  // One step back for each Escape: out of the whole window or the middle to the side, then closed.
  const escape = useCallback((): void => {
    if (latest.current.mode !== "side") setMode("side");
    else latest.current.onClose();
  }, []);
  const preview = useWebPreview({ host, url, box, mode, layoutKey: `${mode}:${width}`, onKey: escape });
  const { phase, state } = preview;

  // It has the keys while it is open, and gives them back where they were when it goes (after it is off the page, or the focus is still on it).
  const before = useRef<HTMLElement | null>(null);
  const back = useRef(returnTo);
  back.current = returnTo;
  useLayoutEffect(() => {
    before.current = focusedNow();
    frame.current?.focus({ preventScroll: true });
  }, []);
  useEffect(
    () => () => {
      const target = back.current?.() ?? before.current;
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
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
  const heading = state?.title || address;
  const failed = state?.status === "failed" || state?.status === "blocked";
  const open = (): void => {
    const handle = preview.handle();
    if (handle) handle.openExternal();
    else openExternally?.(url);
  };

  return (
    <aside ref={frame} className="ks-wp" data-mode={mode} data-surface={surface} data-phase={phase} role="dialog" aria-label="Web page preview" aria-modal="false" tabIndex={-1} style={mode === "side" ? { width } : undefined}>
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
      <div className="ks-wp-bar" role="toolbar" aria-label="Web page preview">
        <IconBtn icon="arrow-left" label="Back" disabled={phase !== "ready"} onClick={() => preview.handle()?.back()} />
        <IconBtn icon="arrow-right" label="Forward" disabled={phase !== "ready"} onClick={() => preview.handle()?.forward()} />
        <IconBtn icon="rotate-cw" label="Reload" disabled={phase !== "ready"} onClick={() => preview.handle()?.reload()} />
        <span className="ks-wp-title" title={address} data-status={state?.status ?? (phase === "opening" ? "loading" : undefined)}>
          {heading}
        </span>
        <IconBtn icon={mode === "center" ? "panel-right" : "rectangle-horizontal"} label={mode === "center" ? "Show at the side" : "Show in the middle"} onClick={() => setMode(mode === "center" ? "side" : "center")} />
        <IconBtn icon={mode === "full" ? "shrink" : "expand"} label={mode === "full" ? "Leave full screen" : "Full screen"} pressed={mode === "full"} onClick={() => setMode(mode === "full" ? "side" : "full")} />
        <IconBtn icon="external-link" label="Open externally" onClick={open} />
        <IconBtn icon="x" label="Close (Esc)" onClick={() => latest.current.onClose()} />
      </div>
      <div ref={box} className="ks-wp-view" data-failed={failed || undefined}>
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
                Open externally
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
                Open externally
              </button>
            </div>
          </div>
        ) : null}
        {phase === "opening" || state?.status === "loading" ? <div className="ks-wp-loading" role="status" aria-label="Loading the page" /> : null}
      </div>
    </aside>
  );
}
