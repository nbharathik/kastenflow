import { DeckEngine, loadSlides } from "@kasten-slides/wasm";
import { type JSX, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { defaultActions } from "./actions.ts";
import { SlideCanvas } from "./canvas/SlideCanvas.tsx";
import { clearSelection, isBareBackground } from "./canvas/outside.ts";
import { copyEvent, pasteEvent, useNativeClipboard } from "./clipboard/events.ts";
import { dispatchKey } from "./commands/index.ts";
import { Dialogs } from "./dialogs/Dialogs.tsx";
import { focusHome, forgetEditor, noteEditor } from "./focus/home.ts";
import { useOrphanKeys } from "./focus/orphan-keys.ts";
import { watchFullScreen } from "./full-screen.ts";
import { GridView } from "./grid/GridView.tsx";
import type { SlidesHost } from "./host.ts";
import { useChromeValue } from "./chrome/chrome.ts";
import { ContextMenus } from "./menus/ContextMenus.tsx";
import { NotesPane } from "./notes/NotesPane.tsx";
import { OutlineView } from "./outline/OutlineView.tsx";
import { Filmstrip } from "./filmstrip/Filmstrip.tsx";
import { GalleryDrawer } from "./gallery/GalleryDrawer.tsx";
import { PanelHost } from "./panels/PanelHost.tsx";
import { EditorWebPreview } from "./preview/EditorWebPreview.tsx";
import { EditorSession, type SessionOptions } from "./session/session.ts";
import { TitleBar } from "./titlebar/TitleBar.tsx";
import { Toolbar } from "./toolbar/Toolbar.tsx";
import { EditorUi, type EditorActions } from "./ui-state.ts";
import { applySnapshot, snapshotKey, snapshotOf, type UiSnapshot } from "./ui-snapshot.ts";
import { useUiState } from "./useUi.ts";
import { useWarmUp } from "./warm-up.ts";
import "./editor.css";
import "./shell.css";

export interface SlidesEditorProps {
  /** The text of the `.deck` file to edit. The editor keeps its own copy from then on; open another deck by giving the editor a new `key`. */
  text: string;
  host: SlidesHost;
  /** What the editor calls when the person asks to present, export or close. */
  actions?: EditorActions;
  /** Called with the editing session when it is ready, and with null when it ends: the host uses it to hand over changes made outside (`receive`). */
  onSession?(session: EditorSession | null, ui: EditorUi | null): void;
  onError?: SessionOptions["onError"];
  /** `light` or `dark`; left out, the system's choice. */
  theme?: "light" | "dark";
  className?: string;
  /** The editor takes the keys (the focus goes to the slide) as soon as it is shown: a deck that was just opened should not need a click before Delete or Ctrl+Z work. */
  autoFocus?: boolean;
  /** Takes the keys again each time this changes to a new value that is not false, null or undefined: the host's way to say "this deck was just brought back" (its tab shown again, its pane focused). */
  focusKey?: unknown;
  /**
   * Whether this editor is the one in use, asked when a key or a clipboard event falls on the page itself (nothing has the focus). If it is, the key goes to the
   * editor as if the slide had had the focus. Left out, such keys are not routed. A host answers true for the focused pane's active deck while none of its own
   * dialogs or presentations is open.
   */
  routeOrphanKeys?: () => boolean;
  /**
   * How the editor's window was last left: the panel, the slide and the picks on it, the filmstrip. Read once, when the editor opens. A host that
   * keeps it (`onUiChange`) gets a deck back as it was after its tab was put away. Parts that no longer fit the deck are skipped.
   */
  initialUi?: Partial<UiSnapshot> | undefined;
  /** Called with the window's state each time it changes (and only then), for the host to keep. */
  onUiChange?(snapshot: UiSnapshot): void;
}

/** The whole deck editor: menus, toolbar, filmstrip, the slide, notes and panels. */
export function SlidesEditor({ text, host, actions, onSession, onError, theme, className = "", autoFocus, focusKey, routeOrphanKeys, initialUi, onUiChange }: SlidesEditorProps): JSX.Element {
  const [made, setMade] = useState<{ session: EditorSession; ui: EditorUi } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const startUi = useRef(initialUi);
  const report = useRef(onUiChange);
  report.current = onUiChange;

  useEffect(() => {
    let session: EditorSession | null = null;
    let cancelled = false;
    loadSlides()
      .then(() => {
        if (cancelled) return;
        session = new EditorSession(DeckEngine.open(text), host, { onError });
        const ui = new EditorUi();
        if (startUi.current) applySnapshot(session, ui, startUi.current);
        setMade({ session, ui });
        onSession?.(session, ui);
      })
      .catch((error: unknown) => !cancelled && setFailed(error instanceof Error ? error.message : String(error)));
    return () => {
      cancelled = true;
      onSession?.(null, null);
      void session?.dispose();
    };
    // The deck is opened once; a different deck is a different editor.
  }, [host]);

  useEffect(() => {
    if (made) made.ui.actions = { ...defaultActions(made.session, host, made.ui), ...actions };
  }, [made, actions, host]);

  // The host is told how the window stands each time it changes, not on every edit of the deck.
  useEffect(() => {
    if (!made) return;
    const { session, ui } = made;
    let last = snapshotKey(snapshotOf(session, ui));
    const check = () => {
      const now = snapshotOf(session, ui);
      const key = snapshotKey(now);
      if (key === last) return;
      last = key;
      report.current?.(now);
    };
    const stops = [session.subscribe(check), ui.subscribe(check), ui.subscribeMemory(check)];
    return () => stops.forEach((stop) => stop());
  }, [made]);

  // The first code block a person opens is not made to wait for the engine's first-use work: it is done once the editor has painted and the page is idle.
  useWarmUp(made !== null);

  const classNames = `ks-editor ${className}`.trim();
  if (failed) {
    return (
      <div className={classNames} data-theme={theme} role="alert">
        <p className="ks-loading">This deck could not be opened: {failed}</p>
      </div>
    );
  }
  if (!made) {
    return (
      <div className={classNames} data-theme={theme}>
        <p className="ks-loading">Opening the deck…</p>
      </div>
    );
  }
  return <Workspace session={made.session} ui={made.ui} className={classNames} theme={theme} autoFocus={autoFocus} focusKey={focusKey} routeOrphanKeys={routeOrphanKeys} />;
}

export interface WorkspaceProps {
  session: EditorSession;
  ui: EditorUi;
  className?: string;
  theme?: "light" | "dark" | undefined;
  autoFocus?: boolean | undefined;
  focusKey?: unknown;
  routeOrphanKeys?: (() => boolean) | undefined;
}

/** The editor once its session exists. Also the way to show an editor for a session made elsewhere (tests). */
export function Workspace({ session, ui, className = "ks-editor", theme, autoFocus, focusKey, routeOrphanKeys }: WorkspaceProps): JSX.Element {
  const view = useUiState(ui);
  const density = useChromeValue(ui, (state) => state.density);
  const context = useMemo(() => ({ session, ui }), [session, ui]);
  const root = useRef<HTMLDivElement>(null);
  // The keys of copy, cut and paste make the browser's events only where the page says they may (`beforecopy` and the like).
  useNativeClipboard(root, context);
  // Keys that fall on the page itself go to this editor while the host says it is the one in use; a deck that was just opened has the keys.
  useOrphanKeys(root, context, routeOrphanKeys);
  useEffect(() => {
    const element = root.current;
    noteEditor(element);
    return () => forgetEditor(element);
  }, []);
  useEffect(() => {
    if (autoFocus) focusHome(root.current);
  }, [autoFocus]);
  useEffect(() => {
    if (focusKey) focusHome(root.current);
  }, [focusKey]);

  // Full screen: the page's own follows the mode, and leaving the editor (unmounting it) leaves full screen.
  useEffect(() => watchFullScreen(ui), [ui]);

  // Keys pressed with focus anywhere in the editor that no region took. In a field only the chords that are never typing (`inFields`) are looked up.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A region that took the key called preventDefault on the native event; React's own flag is a copy made before that.
    if (event.defaultPrevented || event.nativeEvent.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest(".ks-dialog")) return;
    dispatchKey(event.nativeEvent, context, target?.closest("input, textarea, select, [contenteditable='true']") ? "field" : "canvas");
  };

  return (
    <div
      ref={root}
      className={view.fullScreen ? `${className} is-fullscreen` : className}
      data-theme={theme}
      data-density={density}
      // A press on a place nothing inside can take the focus leaves it with the editor (not with the page), so its keys still reach it.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // The keys of copy, cut and paste are the browser's own: the events they make carry the data (`clipboard/events.ts`).
      onCopy={(event) => copyEvent(event, context, false)}
      onCut={(event) => copyEvent(event, context, true)}
      onPaste={(event) => pasteEvent(event, context)}
      // A press on bare background of the title bar, or on the part of a panel that holds nothing (the container itself, below the
      // sections), lets go of what is selected on the slide. The slide and the lists have their own; a gap between two controls is not this.
      onPointerDown={(event) => {
        const target = event.target;
        if (target instanceof HTMLElement && isBareBackground(target) && (target.closest(".ks-titlebar") || target.matches(".ks-side-panel, .ks-sp-tabs, .ks-sp-body"))) clearSelection(session, event);
      }}
      onFocus={(event) => {
        // The editor whose own place took the focus is the one in use (an editor inside this one, the layout designer, is its own).
        if (event.target instanceof Element && event.target.closest(".ks-editor") === root.current) noteEditor(root.current);
        ui.areas.noteFocus(event.target);
      }}
      onBlur={(event) => ui.areas.noteBlur(event.target, event.relatedTarget)}
    >
      <header className="ks-top">
        <TitleBar session={session} ui={ui} />
        <Toolbar session={session} ui={ui} />
      </header>
      <div className="ks-body">
        {view.filmstripOpen && view.view === "edit" ? <Filmstrip session={session} ui={ui} /> : null}
        {view.galleryOpen && view.view === "edit" ? <GalleryDrawer session={session} ui={ui} /> : null}
        <main className="ks-center">
          {view.view === "edit" ? <SlideCanvas session={session} ui={ui} /> : null}
          {view.view === "outline" ? <OutlineView session={session} ui={ui} /> : null}
          {view.view === "grid" ? <GridView session={session} ui={ui} /> : null}
          {view.view === "edit" ? <NotesPane session={session} ui={ui} /> : null}
        </main>
        <PanelHost session={session} ui={ui} />
        <EditorWebPreview session={session} />
      </div>
      <Dialogs session={session} ui={ui} />
      <ContextMenus session={session} ui={ui} />
    </div>
  );
}
