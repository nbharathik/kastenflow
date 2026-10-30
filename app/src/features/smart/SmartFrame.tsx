import "./smart.css";

import { useEffect, useRef, useState, type RefObject } from "react";

import { inTauri } from "../../lib/api";
import { MAX_BLOCK_HEIGHT_PX, type SmartTheme } from "../../lib/vault/smart-types";
import { useWorkspace } from "../workspace/store";
import { tauriSmartBackend, type SmartBackend } from "./backend";
import { BridgeHost, MIN_HEIGHT_PX } from "./bridge-host";
import { recorderFor } from "./author/snapshot";
import { ErrorChip } from "./ErrorChip";
import { SMART_SANDBOX } from "./schema";
import { frameUrl } from "./urls";
import { onVaultChange } from "./vault-changes";

/** How tall a frame is before its page says what it needs. */
const DEFAULT_HEIGHT_PX = 320;

export interface SmartFrameProps {
  /** The smart page's path, and the id its address is made with. */
  pagePath: string;
  pageId: string;
  /** What screen readers call the frame. */
  title: string;
  /** The file of the page's folder to show (`index.html`, or the entry of a named view). */
  entry?: string;
  /** The named view being shown (`![[Page#view]]`); the page is told. */
  view?: string;
  /** The height to start with, and the most the page may ask for. A block is never taller than 1200 px. */
  height?: number;
  maxHeight?: number;
  /** Fill the room the parent gives (a smart page opened on its own) instead of taking a height. */
  fill?: boolean;
  /** Changes when the frame must load again (the page's leave for web pictures changed). */
  reloadKey?: string | number;
  /** How the app is asked; the desktop app's own unless a test gives another. */
  backend?: SmartBackend;
  /** Show the small count of the page's errors under the frame (on by default). */
  showErrors?: boolean;
  /** Called when the page reported an error (the code editor shows the list itself). */
  onErrors?(): void;
}

function useAppTheme(): SmartTheme {
  const read = (): SmartTheme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const [theme, setTheme] = useState<SmartTheme>(read);
  useEffect(() => {
    const watch = new MutationObserver(() => setTheme(read()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);
  return theme;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  return visible;
}

/**
 * Whether the box is on screen now, and whether it has been at all. A page
 * is not loaded until its frame is first scrolled into view, and a box that
 * is hidden (a tab kept ready, a folded block) or scrolled away counts as off
 * screen. Without an observer (no layout) it counts as on screen.
 */
function useOnScreen(box: RefObject<HTMLElement | null>): { seen: boolean; now: boolean } {
  const canObserve = typeof IntersectionObserver !== "undefined";
  const [state, setState] = useState({ seen: !canObserve, now: !canObserve });
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (!last) return;
      setState((was) => ({ seen: was.seen || last.isIntersecting, now: last.isIntersecting }));
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [box]);
  return state;
}

/**
 * A smart page, in its sandboxed frame. The frame can only post messages to
 * the window; the bridge host answers them (see `bridge-host.ts`). It loads
 * when it is first scrolled into view, and while it is hidden or the window
 * is in the background its watches send nothing.
 */
export function SmartFrame({ pagePath, pageId, title, entry = "index.html", view, height, maxHeight, fill = false, reloadKey, backend, showErrors = true, onErrors }: SmartFrameProps) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const host = useRef<BridgeHost | null>(null);
  const theme = useAppTheme();
  const themeNow = useRef(theme);
  themeNow.current = theme;
  const documentVisible = useDocumentVisible();
  const screen = useOnScreen(box);
  const paused = !documentVisible || !screen.now;
  const pausedNow = useRef(paused);
  pausedNow.current = paused;
  const limit = Math.min(maxHeight ?? MAX_BLOCK_HEIGHT_PX, MAX_BLOCK_HEIGHT_PX);
  const [px, setPx] = useState(() => Math.max(MIN_HEIGHT_PX, Math.min(height ?? DEFAULT_HEIGHT_PX, limit)));
  const [errorVersion, setErrorVersion] = useState(0);
  const asked = backend ?? tauriSmartBackend;
  const available = backend !== undefined || inTauri();
  const loaded = available && screen.seen;
  // Each frame instance has a secret of its own, made by the app before the frame is shown: it is in
  // every address the frame loads from, and the app serves nothing for one it does not know.
  const instance = `${pagePath}\u0000${pageId}\u0000${reloadKey ?? ""}\u0000${entry}`;
  const [secret, setSecret] = useState<{ instance: string; frame: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const frameToken = secret?.instance === instance ? secret.frame : null;

  useEffect(() => {
    if (!loaded) return;
    let gone = false;
    let opened: string | null = null;
    setFailed(false);
    asked
      .openFrame(pagePath)
      .then((made) => {
        // Unmounted (or moved on) while the app was making it: end it at once.
        if (gone) return void asked.closeFrame(made).catch(() => {});
        opened = made;
        setSecret({ instance, frame: made });
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
      // The frame goes first (it unmounts with this effect), then its secret stops being served.
      if (opened) void asked.closeFrame(opened).catch(() => {});
      // A tab kept ready out of sight cleans up its effects but keeps its elements: without a
      // secret the frame is taken out of the page, so a page nobody sees stops running.
      setSecret(null);
    };
  }, [loaded, asked, pagePath, instance]);

  useEffect(() => {
    if (!loaded || frameToken === null) return;
    const bridge = new BridgeHost({
      pagePath,
      pageId,
      frameToken,
      ...(view ? { view } : {}),
      backend: asked,
      frame: () => frame.current?.contentWindow ?? null,
      theme: () => themeNow.current,
      onVaultChange,
      onOpen: (path) => useWorkspace.getState().openPath(path),
      onResize: (next) => {
        if (!fill) setPx(next);
      },
      onReported: () => {
        setErrorVersion((n) => n + 1);
        onErrors?.();
      },
      // Kept under the page's id, not its path: another page later made at the same path never inherits the answers.
      record: recorderFor(pageId || pagePath),
      maxHeight: limit,
    });
    bridge.setPaused(pausedNow.current);
    const detach = bridge.attach(window);
    host.current = bridge;
    return () => {
      detach();
      bridge.dispose();
      host.current = null;
    };
  }, [loaded, frameToken, pagePath, pageId, view, asked, fill, limit]);

  useEffect(() => {
    host.current?.setPaused(paused);
  }, [paused, loaded]);

  const sentTheme = useRef(theme);
  useEffect(() => {
    if (sentTheme.current === theme) return;
    sentTheme.current = theme;
    host.current?.sendTheme(theme);
  }, [theme]);

  return (
    <div ref={box} className="kasten-smart" data-fill={fill ? "true" : "false"}>
      {!available ? (
        <p className="kasten-smart-note">Smart pages open in the KastenFlow app.</p>
      ) : failed ? (
        <p className="kasten-smart-note">This page could not be started. Try opening it again.</p>
      ) : !loaded || frameToken === null ? (
        <p className="kasten-smart-wait" role="status">
          Loading this page…
        </p>
      ) : (
        <iframe
          key={frameToken}
          ref={frame}
          src={frameUrl(frameToken, pageId, entry)}
          title={title}
          // Its own scripts and nothing else: no same-origin, no popups, no top navigation, no forms.
          sandbox={SMART_SANDBOX}
          referrerPolicy="no-referrer"
          className="kasten-smart-frame"
          style={fill ? undefined : { height: px }}
          onLoad={() => host.current?.frameLoaded()}
        />
      )}
      {loaded && frameToken !== null && showErrors && <ErrorChip pagePath={pagePath} backend={asked} version={errorVersion} />}
    </div>
  );
}
