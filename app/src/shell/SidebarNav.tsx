// The sidebar's list of views: the ones pinned (Inbox, Journal, Tasks and
// Calendar to begin with), any other that is open or has a count, and a
// "More views" row that opens the list of all of them in place.

import { useBrowserOn } from "../features/browser/prefs";
import { isCapturesPlace, useCapturesShown } from "../features/extension/captures";
import { usePendingCount } from "../features/review/store";
import { usePluginsVersion } from "../plugins/registry";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { inboxCards } from "../features/workspace/tree";
import { Icon } from "../ui/Icon";
import { sidebarNav } from "./nav";
import { useNavPins } from "./nav-pins";
import { IDLE_ROW, NavButton, ROW, useNavMenu } from "./NavRow";
import { NavList } from "./NavList";

/** The view in the focused tab, as the list names it: a journal page is the journal. */
const openView = (s: ReturnType<typeof useWorkspace.getState>): string =>
  s.place.view === "page" && s.place.path?.startsWith("journal/") ? "journal" : s.place.view === "web" ? "browser" : isCapturesPlace(s.place) ? "captures" : s.place.view;

export function SidebarNav() {
  // Lists the Browser once it is turned on, and Captures once there are some or a way to make them is on.
  useBrowserOn();
  useCapturesShown();
  // And the rows plugins add, while they are on.
  usePluginsVersion();
  const pins = useNavPins();
  const { onMenu, menu } = useNavMenu(pins);
  const open = useWorkspace(openView);
  const inbox = useWorkspace((s) => inboxCards(s.notes).length);
  const reviews = usePendingCount();
  const more = usePrefs((s) => s.moreViews);
  const counts: Record<string, number> = { inbox, review: reviews };
  const counted = new Set(Object.keys(counts).filter((id) => counts[id]! > 0));
  const shown = sidebarNav(pins.pinned, { open, counted });

  return (
    <>
      {shown.map((item) => (
        <NavButton key={item.id} item={item} badge={counts[item.id]} onMenu={onMenu} />
      ))}
      <button
        type="button"
        aria-expanded={more}
        onClick={() => usePrefs.getState().set({ moreViews: !more })}
        className={`${ROW} ${IDLE_ROW}`}
      >
        <Icon name="chevron" className={`size-[17px] transition-transform ${more ? "rotate-90" : ""}`} />
        <span className="flex-1">More views</span>
      </button>
      {more && <NavList className="mb-1 max-h-[45vh] overflow-y-auto pb-1" />}
      {menu}
    </>
  );
}
