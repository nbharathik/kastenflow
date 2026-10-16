// The right panel beside an open page: the page's details in one tab (its
// properties, outline, links and facts, one under the other) and its history in
// the next and its comments in the third. Ctrl+. shows or hides it;
// Ctrl+Shift+H opens it on History. The chat is the window's own, docked at
// the right (ChatDock), not a tab of each page.

import "./panel.css";

import { useId, useMemo, useRef, type KeyboardEvent, type RefObject } from "react";

import { useShell } from "../../lib/store";
import type { NoteMeta, VaultClient } from "../../lib/vault/types";
import type { PageSession } from "../workspace/page/page-session";
import { keyTitle } from "../shortcuts/store";
import { usePaneId } from "../workspace/pane-context";
import { HighlightsSection } from "../annotations/HighlightsSection";
import type { HighlightsModel } from "../annotations/use-text-highlights";
import { CommentsTab } from "../pages/comments/CommentsTab";
import type { CommentsEditor } from "../pages/comments/use-comments";
import { HistoryTab } from "./history/HistoryTab";
import { LinksTab } from "./links/LinksTab";
import { Outline, PageFacts } from "./outline/Outline";
import type { PanelPage, Reload } from "./page-edit";
import { PANEL_SHARE, PANEL_TABS, usePanel, usePanelTab, usePanelWidth } from "./panel-store";
import { PropertiesTab } from "./properties/PropertiesTab";
import { ResizeHandle } from "./ResizeHandle";
import { Icon } from "../../ui/Icon";

export interface RightPanelProps {
  /** The note as the workspace lists it now. */
  note: NoteMeta;
  /** The page's current body; the History tab compares versions with it. */
  body: string;
  /** The page's body element, for the outline and word counts. */
  root: RefObject<HTMLDivElement | null>;
  client: VaultClient;
  session: PageSession;
  /** Starts the page again on a note, after a change the session cannot adopt. */
  onReload: Reload;
  /** The page's editor, for the Comments tab to place comments in its words and to show them. */
  editor?: RefObject<CommentsEditor | null>;
  /** Counts the times the editor became ready. */
  ready?: number;
  /** The highlights on a page kept from the web, listed in the Details tab. */
  highlights?: HighlightsModel;
}

export function RightPanel({ note, body, root, client, session, onReload, editor, ready = 0, highlights }: RightPanelProps) {
  const paneId = usePaneId();
  const tab = usePanelTab(paneId);
  const width = usePanelWidth(paneId);
  const page = useMemo<PanelPage>(() => ({ client, session, onReload }), [client, session, onReload]);
  const id = useId();

  return (
    <aside className="kasten-side-panel" style={{ width, maxWidth: `${PANEL_SHARE * 100}%` }} aria-label="Page details">
      <ResizeHandle pane={paneId} />
      <div className="kasten-panel-top">
        <PanelTabs id={id} pane={paneId} />
        <button type="button" className="kasten-panel-close" aria-label="Close panel" title={keyTitle("Close panel", "panel")} onClick={() => useShell.getState().togglePanel(paneId)}>
          <Icon name="close" className="size-4" />
        </button>
      </div>
      <div className="kasten-panel-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} data-tab={tab}>
        {tab === "details" && (
          <>
            <PropertiesTab note={note} page={page} />
            <Outline root={root} />
            <LinksTab note={note} page={page} />
            {highlights && editor && <HighlightsSection model={highlights} editor={editor} ready={ready} />}
            <PageFacts note={note} root={root} />
          </>
        )}
        {tab === "history" && <HistoryTab note={note} body={body} page={page} />}
        {tab === "comments" && editor && <CommentsTab client={client} path={session.path} editor={editor} ready={ready} body={body} />}
      </div>
    </aside>
  );
}

/** A segmented control; arrow keys move between tabs. */
function PanelTabs({ id, pane }: { id: string; pane: string }) {
  const tab = usePanelTab(pane);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const at = PANEL_TABS.findIndex((t) => t.id === tab);
    const n = PANEL_TABS.length;
    const next = { ArrowRight: (at + 1) % n, ArrowLeft: (at - 1 + n) % n, Home: 0, End: n - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    usePanel.getState().setTab(pane, PANEL_TABS[next]!.id);
    buttons.current[next]?.focus();
  };
  return (
    <div className="kasten-panel-tabs" role="tablist" aria-label="Panel" onKeyDown={onKeyDown}>
      {PANEL_TABS.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${id}-${t.id}`}
          aria-selected={tab === t.id}
          aria-controls={`${id}-panel`}
          tabIndex={tab === t.id ? 0 : -1}
          className="kasten-panel-tab"
          onClick={() => usePanel.getState().setTab(pane, t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
