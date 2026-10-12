import "./settings.css";
import "./settings-rows.css";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { VaultChooser } from "../../../vaults/VaultChooser";
import type { GroupId } from "./index";
import { SettingsNav } from "./SettingsNav";
import { GroupPage, Results, resultsId } from "./SettingsPage";
import { useNarrow } from "./useNarrow";
import { useSettings } from "./useSettings";

/** The settings window: the groups and a search on the left, one group at a
 * time (or what a search found) on the right. `/` or Ctrl+F goes to the search,
 * and Escape empties it. Switching vault takes the window's place for a while. */
export function Settings() {
  const [switching, setSwitching] = useState(false);
  if (switching) return <VaultChooser onCancel={() => setSwitching(false)} />;
  return <SettingsWindow onSwitchVault={() => setSwitching(true)} />;
}

function SettingsWindow({ onSwitchVault }: { onSwitchVault(): void }) {
  const state = useSettings();
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);
  const { query, found, focusSearch, setQuery } = state;

  // Ctrl+F (Cmd+F) searches the settings rather than the window's text.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
      const el = root.current;
      if (!el) return;
      const active = document.activeElement;
      const here = el.contains(active) || (active === document.body && el.closest(".kasten-pane")?.classList.contains("is-focused"));
      if (!here) return;
      event.preventDefault();
      focusSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const typing = target.matches("input, textarea, select, [contenteditable='true']");
    if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      focusSearch();
    } else if (event.key === "Escape" && query && !typing && !event.defaultPrevented) {
      setQuery("");
    }
  };

  // While searching, a group in the list scrolls to its results; otherwise it opens.
  const pick = (group: GroupId) => (found ? document.getElementById(resultsId(group))?.scrollIntoView?.({ block: "start" }) : state.pick(group));
  const page = { flash: state.flash, open: state.open, onSwitchVault };

  return (
    <div ref={root} className={`kasten-settings${narrow ? " is-narrow" : ""}`} onKeyDown={onKeyDown}>
      <SettingsNav query={query} onQuery={setQuery} found={found} current={state.group} onPick={pick} folded={state.folded} onFold={state.fold} search={state.search} narrow={narrow} />
      <div ref={state.main} className="kasten-set-main">
        {found ? <Results {...page} found={found} query={query} words={state.words} onClear={() => setQuery("")} /> : <GroupPage key={state.group} {...page} group={state.group} />}
      </div>
    </div>
  );
}
