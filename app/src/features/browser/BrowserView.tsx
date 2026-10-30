// The browser tab: a bar, and a page shown by a native view laid over the
// stage (browser/use-bounds.ts keeps it there). The view is the app's, made on
// first need, hidden while anything opens over it and when the tab is not
// shown, and closed with the tab (web-state.ts). With no address the tab shows
// a start page of favourites; with the browser off, a note saying where to turn it on.

import "./browser.css";

import { useEffect, useRef, useState } from "react";

import { openUrl } from "../../lib/api";
import { said } from "../../lib/said";
import { Button } from "../../ui/Button";
import { openSettingsAt } from "../workspace/views/settings/jump";
import { usePaneId } from "../workspace/pane-context";
import { useWorkspace } from "../workspace/store";
import { activeTab, type Place } from "../workspace/tabs";
import { interpret } from "./address";
import { browserBackend } from "./backend";
import { BrowserBar } from "./BrowserBar";
import { Note, StartPage } from "./BrowserNotes";
import { CapturePanel } from "./CapturePanel";
import { BROWSER_EVENT, openWebTab, takeAddressFocus, type BrowserCommand } from "./commands";
import { covered, useOcclusion } from "./occlusion";
import { engineNamed, useBrowserOn, useBrowserPrefs } from "./prefs";
import { useWebTitles } from "./titles";
import { useBounds } from "./use-bounds";
import { useCapture } from "./use-capture";
import { useSavePaper } from "./use-save-paper";
import { useFullScreen } from "./use-full-screen";
import { startBrowserEvents, useWebTabs } from "./web-state";
import type { Bounds } from "./types";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function BrowserView({ place }: { place: Place }) {
  const backend = browserBackend();
  const paneId = usePaneId();
  const tabId = useWorkspace((s) => {
    const pane = s.layout.panes.find((p) => p.id === paneId);
    return pane ? activeTab(pane).id : "";
  });
  const on = useBrowserOn();
  const known = useBrowserPrefs((s) => s.known);
  const engine = useBrowserPrefs((s) => engineNamed(s.custom, s.engine));
  const favourites = useBrowserPrefs((s) => s.favourites);
  const url = place.url;
  const hasUrl = Boolean(url);
  const tab = useWebTabs((s) => s.tabs[tabId]);
  const live = tab?.live ?? false;
  const title = useWebTitles((s) => (url ? s.titles[url] : undefined));

  const stage = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  /** Why the page could not be shown or went wrong, from the app. */
  const [error, setError] = useState<string | null>(null);
  /** What was typed in the address box that cannot be opened. */
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const { full, toggle: toggleFull } = useFullScreen();

  useEffect(() => {
    startBrowserEvents();
  }, []);

  // A tab just made by "New web tab" (or Ctrl+T on a browser tab) starts with the cursor in its address box.
  useEffect(() => {
    if (!hasUrl && takeAddressFocus()) address.current?.focus();
  }, [tabId]);

  const capture = useCapture(tabId, (saved) => useWorkspace.getState().toast(`Kept in ${saved.place}`, { label: "Open", run: () => useWorkspace.getState().openPath(saved.path) }));
  const paper = useSavePaper(tabId);

  // What the native view does is asked of the app one thing at a time, so a
  // quick hide and show never cross.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = (job: () => Promise<unknown>) => {
    queue.current = queue.current.then(job).catch((err: unknown) => setError(message(err)));
  };

  const active = on && backend.available && hasUrl;
  const box = useBounds(stage, setBounds, active);
  const holds = useOcclusion((s) => s.holds);
  const hidden = box !== null && covered(holds, box);
  const wanted = active && !hidden && bounds !== null;

  // Said to the toasts and the like, which keep clear of where the view is.
  useEffect(() => {
    useOcclusion.getState().show(tabId, wanted ? box : null);
  }, [wanted, box, tabId]);
  useEffect(() => () => useOcclusion.getState().show(tabId, null), [tabId]);

  const latest = useRef({ url, bounds, tabId });
  useEffect(() => {
    latest.current = { url, bounds, tabId };
  });

  // Shown when wanted, hidden when not (and made, or made again, as needed).
  const shown = useRef(false);
  useEffect(() => {
    if (wanted) {
      if (shown.current && live) return;
      shown.current = true;
      run(async () => {
        const now = latest.current;
        if (!now.url || !now.bounds) return;
        await backend.open(now.tabId, now.url, now.bounds);
        useWebTabs.getState().patch(now.tabId, { live: true });
        setError(null);
      });
    } else if (shown.current) {
      shown.current = false;
      run(() => backend.hide(tabId));
    }
  }, [wanted, live, tabId]);

  // Moved or resized while shown.
  useEffect(() => {
    if (wanted && live && bounds) run(() => backend.bounds(tabId, bounds));
  }, [bounds]);

  // Not shown any more (another tab, another view): hidden, not closed.
  useEffect(
    () => () => {
      // The view is going away anyway; a native view that stays shown is hidden by the next tab's own show.
      if (shown.current) void backend.hide(tabId).catch(() => {});
      shown.current = false;
    },
    [tabId],
  );

  const go = (text: string) => {
    const made = interpret(text, engine);
    if ("error" in made) return setNotice(made.error);
    setNotice(null);
    if (live) run(() => backend.nav(tabId, { action: "url", url: made.url }));
    else useWorkspace.getState().setWebUrl(tabId, made.url);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (useWorkspace.getState().layout.focus !== paneId) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        address.current?.focus();
      } else if (event.key === "Escape" && full && !event.defaultPrevented) {
        event.preventDefault();
        void toggleFull();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paneId, full]);

  // The palette's commands for the browser tab in focus.
  const startCapture = capture.start;
  const savePaper = paper.start;
  useEffect(() => {
    const onCommand = (event: Event) => {
      if (useWorkspace.getState().layout.focus !== paneId) return;
      const command = (event as CustomEvent<BrowserCommand>).detail;
      if (command === "address") address.current?.focus();
      else if (command === "save-paper") {
        if (live) void savePaper();
      } else if (live) {
        setPicking(false);
        void startCapture(command === "capture-page" ? "page" : "selection");
      }
    };
    window.addEventListener(BROWSER_EVENT, onCommand);
    return () => window.removeEventListener(BROWSER_EVENT, onCommand);
  }, [paneId, live, startCapture, savePaper]);

  const panel = capture.phase !== "idle" || picking || capture.error !== null;
  const stageNote = !backend.available ? (
    <Note heading="The browser needs the desktop app">Web pages are shown by the app's own web view, which the browser preview does not have.</Note>
  ) : known && !on ? (
    <Note heading="The browser is off">
      It opens web pages in a view of its own, with its own cookies and history, kept apart from KastenFlow's. Turn it on in Settings.
      <Button tone="primary" onClick={() => openSettingsAt("Browser", "tab")}>
        Open Browser settings
      </Button>
    </Note>
  ) : !hasUrl ? (
    <StartPage favourites={favourites} onGo={go} />
  ) : error && !live ? (
    <Note heading="This page could not be shown">
      {error}
      {url && <Button onClick={() => void openUrl(url).catch(said("Could not open the system browser"))}>Open in system browser</Button>}
    </Note>
  ) : hidden ? (
    <Note heading={title ?? url ?? "Browser"}>Hidden while something is open over it.</Note>
  ) : null;

  return (
    <div className="kasten-browser">
      <BrowserBar
        url={url}
        loading={tab?.loading ?? false}
        live={live && !hidden}
        fullScreen={full}
        address={address}
        target={capture.target}
        reading={capture.phase === "reading" || capture.phase === "saving" || paper.busy}
        onGo={go}
        onNav={(action) => run(() => backend.nav(tabId, { action }))}
        onNewTab={openWebTab}
        onFull={() => void toggleFull()}
        onSystem={() => url && void openUrl(url).catch((err: unknown) => setError(message(err)))}
        onCapture={(kind) => {
          setPicking(false);
          void capture.start(kind);
        }}
        onSavePaper={() => void paper.start()}
        onSendTo={() => setPicking(true)}
      />
      {(notice ?? (live ? error : null)) && (
        <p role="alert" className="px-3 py-1.5 text-13 text-danger">
          {notice ?? error}
        </p>
      )}
      {panel && <CapturePanel capture={capture} picking={picking} onPicking={setPicking} />}
      <div ref={stage} className="kasten-browser-stage" aria-label="Page">
        {stageNote}
      </div>
    </div>
  );
}
