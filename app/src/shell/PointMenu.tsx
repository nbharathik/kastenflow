import "../features/pages/editor/styles/tokens.css";
import "../features/pages/page/popups.css";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

import { boxOf } from "../features/browser/bounds";
import { useOccludes } from "../features/browser/occlusion";
import { Popup } from "../features/pages/page/Popup";
import { moveInMenu } from "../ui/menu-keys";
import { MenuItems, type MenuItem } from "./Menu";

/** Room kept between the menu and the window's edges. */
const EDGE = 8;

interface Props {
  /** Where the menu opens: the pointer, or the corner of a button. */
  x: number;
  y: number;
  label: string;
  items: (MenuItem | "divider")[];
  onClose: () => void;
  /** The button that opened it, whose clicks are left to it. */
  anchor?: RefObject<HTMLElement | null>;
}

/** A menu of actions at a point, over everything else (a center peek
 * included): from a right-click or a small button. It stays inside the
 * window, the arrows move between its items, Escape or a press outside closes
 * it, and the dialog behind it keeps its Escape. */
export function PointMenu({ x, y, label, items, onClose, anchor }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // Over a browser tab's page it would be hidden behind it.
  useOccludes(true, () => (box.current ? boxOf(box.current.getBoundingClientRect()) : null));
  const [at, setAt] = useState<CSSProperties>({ left: x, top: y, visibility: "hidden" });

  // Kept inside the window: it opens upwards or to the left where there is no room.
  useLayoutEffect(() => {
    const size = box.current?.firstElementChild?.getBoundingClientRect();
    const width = size?.width ?? 0;
    const height = size?.height ?? 0;
    setAt({ left: Math.max(EDGE, Math.min(x, window.innerWidth - EDGE - width)), top: Math.max(EDGE, Math.min(y, window.innerHeight - EDGE - height)) });
  }, [x, y]);

  // A scrolled or resized window leaves the menu behind: close it.
  useEffect(() => {
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      className="fixed z-[70]"
      style={at}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          // Closed by the popup; the dialog behind (a center peek) stays.
          event.preventDefault();
        } else if (event.key === "Tab") {
          event.preventDefault();
          onClose();
        } else {
          // The arrows, Home and End move between the items; Enter and
          // Space click the focused one, as it is a button.
          moveInMenu(event, box.current?.querySelector<HTMLElement>('[role="menu"]') ?? null);
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Popup label={label} role="menu" anchor={anchor} onClose={onClose} className="kasten-shell-menu min-w-56 p-1 outline-none">
        <MenuItems items={items} onPick={onClose} />
      </Popup>
    </div>
  );
}
