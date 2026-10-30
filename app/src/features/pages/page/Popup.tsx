import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

import { originFor, useLeaveGhost } from "../../../lib/presence";
import { keepTabInside } from "../../../ui/focus-trap";
import { useOccludesElement } from "../../browser/occlusion";

/** A popup fades out in this long (the fast step). */
const EXIT_MS = 90;

interface PopupProps {
  label: string;
  /** "menu" for a list of actions; a dialog otherwise. */
  role?: "dialog" | "menu";
  className?: string;
  /** The button that toggles the popup; clicks on it are left to it. */
  anchor?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/** A small floating panel that closes on Escape or a click outside it.
 * The focus moves into it as it opens, stays inside a dialog while Tab is
 * pressed, and goes back to the button that opened it as it closes. */
export function Popup({ label, role = "dialog", className = "", anchor, onClose, children }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  // A browser tab's page beside the popup steps aside while it is open.
  useOccludesElement(ref);
  // It fades out as its parent takes it away.
  useLeaveGhost(ref, EXIT_MS, true);
  // It grows out of its button, on the side the button is on. Placed again a
  // frame later, for menus that are put in place after their first layout.
  useLayoutEffect(() => {
    const grow = () => {
      const box = ref.current;
      const at = anchor?.current;
      if (box && at) box.style.transformOrigin = originFor(at.getBoundingClientRect(), box.getBoundingClientRect());
    };
    grow();
    const frame = requestAnimationFrame(grow);
    return () => cancelAnimationFrame(frame);
  }, [anchor]);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor?.current?.contains(target)) close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      // Escape in a submenu closes that submenu (its own handler), not the menu around it.
      if (event.key === "Escape") {
        if (!(document.activeElement as HTMLElement | null)?.closest?.("[data-menu-sub]")) close.current();
      } else if (role === "dialog" && ref.current?.contains(document.activeElement)) keepTabInside(event, ref.current);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, role]);

  // In as it opens (a field that focuses itself keeps it), back as it closes.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    if (root && !root.contains(document.activeElement)) {
      (root.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled]), [tabindex='0']") ?? root).focus();
    }
    return () => {
      const now = document.activeElement;
      if (now && now !== document.body && now.isConnected) return;
      const back = anchor?.current ?? before;
      if (back?.isConnected) back.focus();
    };
  }, [anchor]);

  return (
    <div ref={ref} role={role} aria-label={label} tabIndex={-1} className={`kasten-popup ${className}`}>
      {children}
    </div>
  );
}
