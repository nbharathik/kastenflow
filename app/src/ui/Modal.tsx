// A modal panel over a dimmed window: dialogs, the palette, the template
// gallery, center peek. Closes on Escape or a press outside the panel,
// keeps Tab inside it, and gives focus back afterwards.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useOccludes } from "../features/browser/occlusion";
import { useLeaveGhost } from "../lib/presence";
import { keepTabInside } from "./focus-trap";

/** How long the modal takes to fade out (the base step, as ui.css). */
const EXIT_MS = 140;

/** A press this soon after the modal opened is the second half of the
 * double-click that opened it, not a press outside. */
const DOUBLE_CLICK_MS = 450;

interface ModalProps {
  /** The dialog's name, or `labelledBy`: the id of the heading that names it. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  /** "alertdialog" for a question before a step that is hard to take back. */
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  className?: string;
  /** The panel brings its own look (the palette, the gallery); the modal
   * only dims the window and places the panel, higher up, where a search
   * box belongs. */
  plain?: boolean;
  children: ReactNode;
}

export function Modal({ label, labelledBy, describedBy, role = "dialog", onClose, className = "", plain, children }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const opened = useRef(0);
  // Taken as the modal first renders, before a field inside takes focus.
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  // A browser tab's page is drawn above the window: it steps aside while this is open.
  useOccludes();
  // The window and panel fade out as the parent takes the modal away.
  useLeaveGhost(overlay, EXIT_MS, false);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    opened.current = performance.now();
    // A field that asked for focus keeps it; otherwise the panel takes it.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      // Menus inside the panel close first; they stop the event.
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close.current();
      }
      keepTabInside(event, panel.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.({ preventScroll: true });
    };
  }, [before]);

  return createPortal(
    <div
      ref={overlay}
      className={`ui-overlay${plain ? " is-high" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && performance.now() - opened.current > DOUBLE_CLICK_MS) close.current();
      }}
    >
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={plain ? `outline-none ${className}` : `ui-modal ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
