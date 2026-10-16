// Tab sets, at the end of a pane's tabs: save the tabs open here under a
// name and open them all again later, pinned ones pinned (tab-sets.ts). A set
// can keep the window's layout too (its panes, the sidebar and the right
// panel) and belong to a project, whose card and overview then offer
// "Resume workspace" (workspaces.ts).

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { Popup } from "../features/pages/page/Popup";
import { usePrefs } from "../features/workspace/prefs";
import { titleOf } from "../features/workspace/names";
import { useWorkspace } from "../features/workspace/store";
import { setOf, setOfWindow, withSet, withoutSet, type TabSet } from "../features/workspace/tab-sets";
import type { Pane } from "../features/workspace/tabs";
import { projects } from "../features/workspace/tree";
import { currentArrangement, resumeSet } from "../features/workspace/workspaces";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";

const WIDTH = 300;

/** Names to start from; a name is all it is, the arrangement is whatever is open. */
const ARRANGEMENTS = ["Reading", "Writing", "Presentation prep"] as const;

export function TabSets({ pane }: { pane: Pane }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    setAt({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 8)) });
  }, [open]);
  return (
    <>
      <IconButton ref={button} icon="layers" label="Tab sets" size="sm" active={open} className="my-auto" onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="fixed z-50" style={{ ...at, width: WIDTH }}>
          <Popup label="Tab sets" anchor={button} onClose={() => setOpen(false)} className="kasten-shell-menu relative w-full p-1.5">
            <SetsMenu pane={pane} onDone={() => setOpen(false)} />
          </Popup>
        </div>
      )}
    </>
  );
}

function SetsMenu({ pane, onDone }: { pane: Pane; onDone(): void }) {
  const sets = usePrefs((s) => s.tabSets);
  const notes = useWorkspace((s) => s.notes);
  const layout = useWorkspace((s) => s.layout);
  const [name, setName] = useState("");
  const [withLayout, setWithLayout] = useState(false);
  const [project, setProject] = useState("");
  const places = projects(notes);
  const titleOfFolder = (folder: string | undefined) => {
    const found = folder ? places.find((p) => p.project === folder) : undefined;
    return found ? titleOf(found) : folder;
  };
  const make = (title: string): TabSet | null => (withLayout ? setOfWindow(layout, title, notes, currentArrangement(), project || undefined) : setOf(pane, title, notes, project || undefined));
  const draft = make(name || "x");
  const save = () => {
    const set = make(name);
    if (!set) return;
    usePrefs.getState().set({ tabSets: withSet(usePrefs.getState().tabSets, set) });
    setName("");
  };
  const openSet = (set: TabSet) => {
    resumeSet(set);
    onDone();
  };
  return (
    <div className="text-13">
      <p className="px-2 pb-1.5 pt-1 text-12 font-semibold text-muted">Tab sets</p>
      <form
        className="space-y-1.5 px-1 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={draft ? `Name these ${draft.tabs.length} tabs…` : "Open some pages first"}
            aria-label="Name for the tabs open here"
            disabled={!draft}
            className="h-7 min-w-0 flex-1 rounded-[4px] bg-well px-2 outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/60"
          />
          <button type="submit" className="ui-btn is-primary is-sm" disabled={!draft || !name.trim()}>
            Save
          </button>
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Names to start from">
          {ARRANGEMENTS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`Start a set called ${preset}`}
              className="rounded-full border border-line px-2 py-0.5 text-12 text-muted hover:bg-hover hover:text-ink"
              onClick={() => {
                setName(preset);
                setWithLayout(true);
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 px-0.5 text-12">
          <input type="checkbox" checked={withLayout} onChange={(e) => setWithLayout(e.target.checked)} className="size-3.5 accent-[var(--color-accent)]" />
          Save layout too
          <span className="text-muted">(all panes, the sidebar and the right panel)</span>
        </label>
        {places.length > 0 && (
          <label className="flex items-center gap-2 px-0.5 text-12">
            Link to project
            <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Link to project" className="ui-field h-7 min-w-0 flex-1 text-12">
              <option value="">None</option>
              {places.map((p) => (
                <option key={p.path} value={p.project!}>
                  {titleOf(p)}
                </option>
              ))}
            </select>
          </label>
        )}
      </form>
      {sets.length === 0 ? (
        <p className="px-2 pb-2 text-12 leading-snug text-muted">Save the tabs open here to bring them all back together later, pinned ones pinned.</p>
      ) : (
        <ul className="border-t border-line pt-1">
          {sets.map((set) => (
            <li key={set.name} className="group flex items-center rounded-[5px] hover:bg-hover">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left" onClick={() => openSet(set)} title={`Open ${set.tabs.length} tabs${set.layout ? " in the layout they were saved with" : ""}`}>
                <Icon name="layers" className="size-[15px] text-muted" />
                <span className="min-w-0 flex-1 truncate">{set.name}</span>
                {set.project && <span className="max-w-[7rem] truncate rounded bg-well px-1.5 text-12 text-muted">{titleOfFolder(set.project)}</span>}
                <span className="text-12 text-muted">
                  {set.tabs.length} tabs{set.layout ? " · layout" : ""}
                </span>
              </button>
              <IconButton
                icon="close"
                label={`Forget the set ${set.name}`}
                size="sm"
                className="mr-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => usePrefs.getState().set({ tabSets: withoutSet(usePrefs.getState().tabSets, set.name) })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
