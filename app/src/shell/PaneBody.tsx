import { useEffect, useLayoutEffect, useRef } from "react";

import { placeKey } from "../features/workspace/drafts";
import { useWorkspace } from "../features/workspace/store";
import type { Pane as PaneData, Tab } from "../features/workspace/tabs";
import { TAB_DRAG } from "./TabStrip";
import { useViewEnter } from "./view-enter";
import { ViewOutlet } from "./ViewOutlet";

/** Where each tab's places were scrolled to, so Back returns there and a
 * new place starts at the top. */
const scrolls = new Map<string, number>();
const MAX_SCROLLS = 300;

/** Where each scroller was last seen scrolled to, from its scroll events:
 * reading scrollTop would lay out the page being opened. */
const seen = new WeakMap<HTMLElement, number>();

function useScrollMemory(key: string) {
  const scroller = useRef<HTMLDivElement>(null);
  // A tab kept ready runs this again when it is shown, which puts the scroll back (a hidden box forgets it).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = scrolls.get(key) ?? 0;
    // Setting scrollTop lays the new page out at once; most pages open at
    // the top of a scroller that is already there.
    // A tab shown again sets it too: a hidden box does not keep its scroll.
    if (target > 0 || (seen.get(el) ?? 0) !== target) el.scrollTop = target;
    // Pages fill in a moment later; keep trying while they grow.
    let frames = 0;
    let raf = 0;
    const settle = () => {
      if (el.scrollTop >= target - 1 || frames++ > 60) return;
      el.scrollTop = target;
      raf = requestAnimationFrame(settle);
    };
    if (target > 0) raf = requestAnimationFrame(settle);
    // Kept as the reader scrolls: by the time the view changes, the old
    // position has already been clamped to the new view's height.
    const onScroll = () => {
      seen.set(el, el.scrollTop);
      scrolls.delete(key);
      scrolls.set(key, el.scrollTop);
      if (scrolls.size > MAX_SCROLLS) scrolls.delete(scrolls.keys().next().value!);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [key]);
  return scroller;
}

/** A hidden tab makes no sound: media pauses when its tab is put away. */
function usePauseWhenHidden(scroller: { current: HTMLElement | null }) {
  useEffect(() => {
    const el = scroller.current;
    return () => el?.querySelectorAll<HTMLMediaElement>("video, audio").forEach((media) => media.pause?.());
  }, [scroller]);
}

/** Focus goes back to where it was in a tab when the tab is shown again. */
function useFocusMemory(scroller: { current: HTMLElement | null }) {
  const last = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = last.current;
    const active = document.activeElement;
    if (el?.isConnected && (!active || active === document.body)) el.focus({ preventScroll: true });
  }, []);
  return (event: { target: EventTarget }) => {
    if (event.target instanceof HTMLElement && scroller.current?.contains(event.target)) last.current = event.target;
  };
}

interface PaneBodyProps {
  pane: PaneData;
  tab: Tab;
  /** The pane was already showing something when this tab mounted: it fades in. */
  fadeOnMount: boolean;
  /** Dragging a tab near the right edge shows where it would split. */
  setDropping: (dropping: boolean) => void;
}

/** One tab's scroller and view. A tab kept ready is this, hidden, with its state. */
export function PaneBody({ pane, tab, fadeOnMount, setDropping }: PaneBodyProps) {
  const ws = useWorkspace.getState();
  // A new page's draft and the page it becomes are one place.
  const at = tab.place.path ? placeKey(tab.place.path) : "";
  const scroller = useScrollMemory(`${tab.id}|${tab.place.view}|${at}`);
  // The journal's days are one place as you move between them.
  useViewEnter(scroller, `${tab.id}|${tab.place.view}|${tab.place.view === "journal" ? "" : at}`, fadeOnMount);
  usePauseWhenHidden(scroller);
  const remember = useFocusMemory(scroller);
  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-auto"
      data-scroll-root
      onFocus={remember}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_DRAG)) return;
        const box = e.currentTarget.getBoundingClientRect();
        const near = e.clientX > box.right - 96;
        setDropping(near);
        if (near) e.preventDefault();
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const data = e.dataTransfer.getData(TAB_DRAG);
        if (!data) return;
        e.preventDefault();
        const { paneId, tabId } = JSON.parse(data) as { paneId: string; tabId: string };
        const moving = useWorkspace.getState().layout.panes.find((p) => p.id === paneId)?.tabs.find((t) => t.id === tabId);
        if (!moving) return;
        ws.focusPane(pane.id);
        ws.splitRight(moving.place);
        const from = useWorkspace.getState().layout.panes.find((p) => p.id === paneId);
        if (from && from.tabs.length > 1) ws.closeTab(paneId, tabId);
      }}
    >
      <ViewOutlet place={tab.place} />
    </div>
  );
}
