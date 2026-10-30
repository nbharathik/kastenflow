// The chat, docked at the right of the window and the same wherever you are:
// one conversation, grounded in the page you are looking at. A new chat
// starts with that page alone; its chip follows the page in the focused pane
// while "Follow active page" is on, and anything pinned or added stays. The
// dock is as wide as the person drags it (320 to 720). Where the window is
// too narrow to keep the panes beside it, the dock takes the whole area and
// the panes are hidden (a web page is a native view that would draw over
// it), with "Show page" to look at them for a moment.

import "./dock.css";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";

import { useShell } from "../../lib/store";
import { Icon } from "../../ui/Icon";
import { ResizeHandle } from "../../ui/ResizeHandle";
import { useBoards } from "../boards/store";
import { boxOf } from "../browser/bounds";
import { holdWhile, useOccludes } from "../browser/occlusion";
import { useShowing } from "../browser/show";
import { useWorkspace } from "../workspace/store";
import { followChip } from "./binding/target";
import { useSwitchMode } from "./binding/use-switch-mode";
import { clampWidth, DOCK_WIDTH, dockLayout, keepWidth, loadWidth } from "./dock";
import { useActivePage, useActiveTarget } from "./open-pages";
import { useSelectionContext } from "./selection/use-selection";
import { useChat } from "./store";
import { following } from "./thread";
import { Conversation, useChatSetup } from "./view/Conversation";

/** Frames the panes stay hidden for after the dock gives the area back, so a
 * native view does not show at its old place before it has been moved. */
const SETTLE_FRAMES = 2;

/** True while `on`, and a moment after, once the layout has settled. */
function useHeld(on: boolean): boolean {
  const [held, setHeld] = useState(on);
  useEffect(() => {
    if (on) return setHeld(true);
    let frames = 0;
    let id = 0;
    const tick = () => (++frames >= SETTLE_FRAMES ? setHeld(false) : void (id = requestAnimationFrame(tick)));
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [on]);
  return held || on;
}

/** The room the dock and the panes share: the width of the area they sit in,
 * less the side stack, kept up to date. The window's width where nothing is
 * measured (a test). `shown` says the dock is on the page to be measured from. */
function useSpace(dock: RefObject<HTMLElement | null>, shown: boolean): number {
  const [space, setSpace] = useState(() => window.innerWidth);
  useLayoutEffect(() => {
    const parent = dock.current?.parentElement;
    const measure = () => {
      const whole = parent?.clientWidth || window.innerWidth;
      const stack = parent?.querySelector<HTMLElement>(".kasten-stack")?.offsetWidth ?? 0;
      setSpace(whole - stack);
    };
    measure();
    window.addEventListener("resize", measure);
    const watch = parent && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (parent) watch?.observe(parent);
    return () => {
      window.removeEventListener("resize", measure);
      watch?.disconnect();
    };
  }, [dock, shown]);
  return space;
}

export function ChatDock() {
  useChatSetup();
  const active = useChat((s) => (s.active && s.threads[s.active] ? s.active : null));
  const follows = useChat((s) => (s.active && s.threads[s.active] ? following(s.threads[s.active]!) : true));
  const page = useActivePage();
  const dock = useRef<HTMLElement>(null);
  const [wanted, setWanted] = useState(loadWidth);
  const [showPage, setShowPage] = useState(false);
  // The dock is on the page once there is a thread to show.
  const mounted = active !== null;
  const space = useSpace(dock, mounted);
  const width = clampWidth(wanted, space);
  const layout = dockLayout(space, width);
  const hidingPanes = layout === "expanded" && !showPage;
  const held = useHeld(hidingPanes);

  // There is always a thread to write in.
  useLayoutEffect(() => {
    const chat = useChat.getState();
    if (!chat.active || !chat.threads[chat.active]) chat.start({ open: true });
  }, [active]);

  // What is in front (a page, deck, whiteboard, diagram or document) is the thread's chip, while it follows.
  // A tab with none of those (Settings, Trash) leaves the chip as it was.
  const target = useActiveTarget();
  const notes = useWorkspace((s) => s.notes);
  const boards = useBoards((s) => s.list);
  const chip = useMemo(() => followChip(target, notes, boards), [target, notes, boards]);
  const chipId = chip ? `${chip.kind}\u0000${chip.ref.join("\u0000")}\u0000${chip.label}` : "";
  const hasTarget = target !== null;
  useEffect(() => {
    if (!active || !follows || !hasTarget) return;
    // A target whose chip cannot be made yet (a page the list does not have) takes the old chip away rather than leave it standing for something else.
    useChat.getState().followPage(active, chip);
    // The chip is made from the target's path and title only.
  }, [active, follows, chipId, hasTarget]);
  // The settings "When I switch pages": the page's own chat, or a new one for each page.
  useSwitchMode(target);
  // Selected text becomes a chip (Settings → "Selected text").
  useSelectionContext(active);

  // Room again once the window is wide enough: back to the panes.
  useEffect(() => {
    if (layout === "docked") setShowPage(false);
  }, [layout]);

  // The panes are hidden, not covered: a browser tab's native view draws
  // above anything the window draws, so it is told something covers it.
  useLayoutEffect(() => {
    const area = dock.current?.parentElement;
    if (!area || !hidingPanes) return;
    area.classList.add("kasten-chat-expanded");
    return () => area.classList.remove("kasten-chat-expanded");
  }, [hidingPanes, mounted]);
  // Not while a slide show holds the whole window: the show's hold already covers it, and the dock must not add its own.
  const presenting = useShowing((s) => s.count > 0);
  useOccludes(held && !presenting, () => (dock.current ? boxOf(dock.current.getBoundingClientRect()) : null));

  if (!active) return null;
  const collapsed = layout === "expanded" && showPage;
  const toggle =
    layout === "expanded" ? (
      <button type="button" className="kasten-chat-icon-button" aria-label="Show page" title="Show the page" onClick={() => setShowPage(true)}>
        <Icon name="page" className="size-4" />
      </button>
    ) : null;
  return (
    <aside
      ref={dock}
      className="kasten-chat-dock"
      aria-label="Chat dock"
      data-layout={collapsed ? "collapsed" : layout}
      style={{ "--chat-dock-width": `${width}px` } as CSSProperties}
      // A browser tab's view would swallow the pointer as the drag crosses it.
      onPointerDownCapture={(e) => (e.target as Element).closest('[role="separator"]') && holdWhile("chat-dock")}
    >
      {collapsed && (
        <button type="button" className="kasten-chat-reopen" aria-label="Show chat" title="Show the chat" onClick={() => setShowPage(false)}>
          <Icon name="chat" className="size-4" />
        </button>
      )}
      <div className="kasten-chat-dock-body" hidden={collapsed}>
        <Conversation id={active} variant="dock" page={page} autoFocus onClose={() => useShell.getState().toggleChat(false)} headExtra={toggle} />
      </div>
      {layout === "docked" && (
        <ResizeHandle
          label="Resize the chat"
          edge="left"
          width={width}
          min={DOCK_WIDTH.min}
          max={clampWidth(DOCK_WIDTH.max, space)}
          initial={DOCK_WIDTH.initial}
          onChange={setWanted}
          onCommit={(next) => {
            setWanted(next);
            keepWidth(next);
          }}
        />
      )}
    </aside>
  );
}
