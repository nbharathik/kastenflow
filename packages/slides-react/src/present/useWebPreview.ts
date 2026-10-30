// One web preview, from the host's side of it: open it (or navigate the one that is open), keep the view placed over the box the panel
// draws, hide it while something of the editor's is open over where it is or while the page failed (so the card shows), hear the page's
// state and the keys it had, and close it when the panel goes.

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { PreviewMode, PreviewPlace, WebPreviewHandle, WebPreviewHost, WebPreviewState } from "../editor/web-preview-host.ts";
import { covered, onCoverChange } from "../editor/ui/covers.ts";

export type PreviewPhase = "opening" | "ready" | "unavailable";

/** Where the box is in the window, in CSS pixels. */
export function measure(box: HTMLElement | null, mode: PreviewMode): PreviewPlace {
  const rect = box?.getBoundingClientRect();
  return { mode, rect: { x: rect?.left ?? 0, y: rect?.top ?? 0, w: rect?.width ?? 0, h: rect?.height ?? 0 } };
}

export interface WebPreviewOptions {
  host: WebPreviewHost;
  url: string;
  /** The box the view is placed over. */
  box: RefObject<HTMLElement | null>;
  mode: PreviewMode;
  /** Changes whenever the box moves for a reason the page cannot see (the side panel was dragged, the mode changed). */
  layoutKey: string;
  /** The page's view had a key the page could not hear (Escape). */
  onKey(key: "Escape"): void;
}

export interface WebPreviewSession {
  phase: PreviewPhase;
  state: WebPreviewState | null;
  /** The page has loaded (only then is the host's view on the screen). */
  loaded: boolean;
  /** The handle, once the host gave one. */
  handle(): WebPreviewHandle | null;
}

export function useWebPreview({ host, url, box, mode, layoutKey, onKey }: WebPreviewOptions): WebPreviewSession {
  const [phase, setPhase] = useState<PreviewPhase>("opening");
  const [state, setState] = useState<WebPreviewState | null>(null);
  const handle = useRef<WebPreviewHandle | null>(null);
  const gone = useRef(false);
  const latest = useRef({ mode, onKey, failed: false, loaded: false });
  latest.current = { mode, onKey, failed: state?.status === "failed" || state?.status === "blocked", loaded: state?.status === "ready" };

  const place = useCallback(() => handle.current?.place(measure(box.current, latest.current.mode)), [box]);
  // The view is off the screen until the page has loaded (a skeleton stands in, so nothing under the view matters), while the editor has
  // something open over it, and while the page failed (the card says why).
  const seen = useCallback(() => {
    const current = handle.current;
    if (!current) return;
    if (covered() || latest.current.failed || !latest.current.loaded) current.hide();
    else current.show();
  }, []);

  // Opening, and navigating when the address changes: the host has one preview, so asking again is navigating it.
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    setState(null);
    host.open(url, measure(box.current, latest.current.mode)).then(
      (opened) => {
        if (gone.current) {
          opened?.close();
          return;
        }
        if (!live) return;
        if (!opened) {
          handle.current = null;
          setPhase("unavailable");
          return;
        }
        handle.current = opened;
        stop = opened.subscribe((event) => (event.type === "state" ? setState(event.state) : latest.current.onKey(event.key)));
        setPhase("ready");
        seen();
        place();
      },
      () => live && setPhase("unavailable"),
    );
    return () => {
      live = false;
      stop?.();
    };
  }, [host, url, box, place, seen]);

  // The panel going closes the preview (and a close that comes before the host answered closes it when it does).
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      const open = handle.current;
      handle.current = null;
      open?.close();
    };
  }, []);

  useLayoutEffect(() => place(), [place, layoutKey, phase]);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(() => place()) : null;
    watch?.observe(element);
    window.addEventListener("resize", place);
    // A move to a screen of another density changes what the box is in physical pixels without resizing it: the window is not told, so
    // the density is watched on its own, and the display change event where the system sends one.
    let density: MediaQueryList | null = null;
    const changed = (): void => {
      place();
      listen();
    };
    const listen = (): void => {
      density?.removeEventListener("change", changed);
      density = typeof window.matchMedia === "function" ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`) : null;
      density?.addEventListener("change", changed);
    };
    listen();
    // The screen is an event target in the engines that send a change (the types do not know it).
    const display = typeof (window.screen as Partial<EventTarget> | undefined)?.addEventListener === "function" ? (window.screen as unknown as EventTarget) : null;
    display?.addEventListener("change", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      watch?.disconnect();
      window.removeEventListener("resize", place);
      density?.removeEventListener("change", changed);
      display?.removeEventListener("change", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [box, place]);

  useEffect(() => onCoverChange(seen), [seen]);
  useEffect(() => seen(), [seen, state?.status, phase]);

  return { phase, state, loaded: state?.status === "ready", handle: () => handle.current };
}
