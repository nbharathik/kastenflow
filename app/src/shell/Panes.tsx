import { Fragment, useEffect, useRef, useState } from "react";

import { PaneContext } from "../features/workspace/pane-context";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { activeTab, type Pane as PaneData } from "../features/workspace/tabs";
import { useShell } from "../lib/store";
import { KeepAlive } from "./KeepAlive";
import { PaneBody } from "./PaneBody";
import { PaneDivider } from "./PaneDivider";
import { TabStrip } from "./TabStrip";
import { TopBar } from "./TopBar";

/** The main area: up to three panes side by side, each with its tabs,
 * with a line between them that moves. */
export function Panes() {
  const panes = useWorkspace((s) => s.layout.panes);
  const focus = useWorkspace((s) => s.layout.focus);
  const focusMode = useShell((s) => s.focusMode);
  const shown = focusMode ? panes.filter((p) => p.id === focus) : panes;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      {shown.map((pane, i) => (
        <Fragment key={pane.id}>
          {i > 0 && <PaneDivider left={shown[i - 1]!} right={pane} />}
          <Pane pane={pane} first={i === 0} last={i === shown.length - 1} focused={pane.id === focus && panes.length > 1} bare={focusMode} />
        </Fragment>
      ))}
    </div>
  );
}

interface PaneProps {
  pane: PaneData;
  first: boolean;
  last: boolean;
  /** Marks the pane keys act on, when there are several. */
  focused: boolean;
  /** Focus mode: only the view. */
  bare: boolean;
}

/** A browser tab is a native window that is hidden when its tab is, so it is never kept ready. */
const canKeep = (tab: PaneData["tabs"][number]) => tab.place.view !== "web";

function Pane({ pane, first, last, focused, bare }: PaneProps) {
  const [dropping, setDropping] = useState(false);
  const ws = useWorkspace.getState();
  const keep = usePrefs((s) => s.keepTabs);
  // Tabs that mount after the pane first showed fade in; the first view shows at once.
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);
  return (
    <section
      aria-label="Pane"
      className={`kasten-pane relative flex min-w-0 flex-col ${last ? "" : "border-r border-line"} ${focused ? "is-focused" : ""}`}
      style={{ flex: `${bare ? 1 : (pane.size ?? 1)} 1 0%` }}
      onMouseDownCapture={() => ws.focusPane(pane.id)}
      onFocusCapture={() => ws.focusPane(pane.id)}
    >
      <PaneContext.Provider value={pane.id}>
        {!bare && <TabStrip pane={pane} actions={last} />}
        {!bare && <TopBar pane={pane} first={first} />}
        <KeepAlive
          items={pane.tabs}
          active={activeTab(pane).id}
          keep={keep}
          canKeep={canKeep}
          render={(tab) => <PaneBody pane={pane} tab={tab} fadeOnMount={settled.current} setDropping={setDropping} />}
        />
        {dropping && <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 rounded-l-xl border-2 border-accent/50 bg-accent/10" aria-hidden="true" />}
      </PaneContext.Provider>
    </section>
  );
}
