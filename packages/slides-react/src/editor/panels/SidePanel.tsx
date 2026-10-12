import { type JSX, type KeyboardEvent, useId } from "react";

import type { EditorSession } from "../session/session.ts";
import type { EditorUi, PanelName } from "../ui-state.ts";
import { IconButton } from "../ui/Button.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { useUiState } from "../useUi.ts";
import { FormatPanel } from "./format/FormatPanel.tsx";
import { FoldsProvider, useFolds } from "./format/PanelSection.tsx";
import { AiPanel } from "./ai/AiPanel.tsx";
import { CommentsTab } from "./Placeholders.tsx";
import { StepsPanel } from "./steps/StepsPanel.tsx";
import { ThemesPanel } from "./themes/ThemesPanel.tsx";
import { TransitionsPanel } from "./transitions/TransitionsPanel.tsx";
import "./side-panel.css";

const TABS: { name: PanelName; label: string; icon: IconName }[] = [
  { name: "format", label: "Format options", icon: "sliders-horizontal" },
  { name: "themes", label: "Themes", icon: "palette" },
  { name: "transitions", label: "Transitions", icon: "film" },
  { name: "steps", label: "Steps", icon: "wand-sparkles" },
  { name: "ai", label: "Assistant", icon: "sparkles" },
];

/**
 * Delete and Backspace inside the panel are not the slide's: a button or a
 * folded section that has the focus must not delete what is selected.
 */
function keepDeletes(event: KeyboardEvent<HTMLElement>): void {
  if (event.key === "Delete" || event.key === "Backspace") event.stopPropagation();
}

/**
 * Enter or Escape in a box of the panel is the end of what was being typed: the
 * change is in (a box commits on Enter), and the keys go back to the slide, so
 * undo and the arrow keys work on it at once instead of on the text of the box.
 * The move waits until the change is drawn, so leaving the box does not put it in twice.
 */
function handBack(event: KeyboardEvent<HTMLElement>): void {
  const box = event.target;
  if (event.key !== "Enter" && event.key !== "Escape") return;
  if (!(box instanceof HTMLInputElement) || box.disabled || !["text", "search", "number"].includes(box.type)) return;
  const stage = event.currentTarget.closest(".ks-editor")?.querySelector<HTMLElement>(".ks-stage");
  if (stage) queueMicrotask(() => stage.focus({ preventScroll: true }));
}

/**
 * The panel on the right: format options, themes, transitions, steps, the assistant. Each tab is an icon, and the one that is open also
 * says its name. `shown` is the panel to draw while it slides away (the window state already says there is none).
 */
export function SidePanel({ session, ui, shown }: { session: EditorSession; ui: EditorUi; shown?: PanelName | null }): JSX.Element {
  const open = useUiState(ui).panel;
  const panel = open ?? shown ?? null;
  const uid = useId();
  const tabId = (name: string) => `${uid}-tab-${name}`;
  const bodyId = `${uid}-body`;
  // The sections a person folded stay folded, whichever tab is shown, and the next time the editor opens.
  const folds = useFolds(ui, ["access"]);

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = TABS.findIndex((tab) => tab.name === panel);
    const next = TABS[(Math.max(at, 0) + step + TABS.length) % TABS.length];
    if (next) {
      ui.openPanel(next.name);
      // The tab that comes up takes the focus once it is drawn.
      const strip = event.currentTarget;
      requestAnimationFrame(() => strip.querySelector<HTMLElement>(`[role="tab"][data-panel="${next.name}"]`)?.focus());
    }
  };

  return (
    <aside
      className="ks-side-panel ks-sp"
      aria-label="Side panel"
      // A press on its words leaves the focus in the panel, so its keys (Ctrl+A) still reach it.
      tabIndex={-1}
      onKeyDown={(event) => {
        keepDeletes(event);
        handBack(event);
      }}
    >
      <div className="ks-sp-tabs" role="tablist" aria-label="Panels" onKeyDown={onTabKey}>
        {TABS.map((tab) => (
          <button
            key={tab.name}
            id={tabId(tab.name)}
            data-panel={tab.name}
            data-tip={tab.label}
            type="button"
            role="tab"
            className="ks-btn ks-sp-tab"
            aria-selected={panel === tab.name}
            aria-controls={bodyId}
            tabIndex={panel === tab.name || (panel === "comments" && tab.name === "format") ? 0 : -1}
            onClick={() => ui.openPanel(tab.name)}
          >
            <Icon name={tab.icon} size={15} />
            <span className="ks-sp-tab-label">{tab.label}</span>
          </button>
        ))}
        <IconButton icon="x" label="Close panel" className="ks-sp-close" onClick={() => ui.openPanel(null)} />
      </div>
      <div id={bodyId} className="ks-sp-body" role="tabpanel" aria-labelledby={tabId(panel ?? "format")}>
        <FoldsProvider folds={folds}>
          {panel === "format" ? <FormatPanel session={session} ui={ui} /> : null}
          {panel === "themes" ? <ThemesPanel session={session} ui={ui} /> : null}
          {panel === "transitions" ? <TransitionsPanel session={session} ui={ui} /> : null}
        </FoldsProvider>
        {panel === "steps" ? <StepsPanel session={session} ui={ui} /> : null}
        {panel === "ai" ? <AiPanel session={session} ui={ui} /> : null}
        {panel === "comments" ? <CommentsTab /> : null}
      </div>
    </aside>
  );
}
