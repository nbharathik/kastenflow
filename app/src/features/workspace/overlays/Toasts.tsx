// Short messages at the top right, below the tabs and the page's actions,
// with Undo where it makes sense. Each one goes after a few seconds (more
// when it offers an action) unless the pointer or the keyboard is on it.

import "./overlays.css";

import { useEffect, useRef, useState } from "react";

import { boxOf } from "../../browser/bounds";
import { useOccludes, useOcclusion } from "../../browser/occlusion";
import { useWorkspace, type Toast } from "../store";
import { Icon } from "../../../ui/Icon";

/** How long a toast stays, and how long it takes to go. */
export const TOAST_MS = { plain: 4000, action: 8000, leave: 140 };

export function Toasts() {
  const toasts = useWorkspace((s) => s.toasts);
  // With a browser tab's page on show, the toasts keep to the bottom left,
  // which its native view does not cover (the page is drawn above them); where
  // one would still be under it, the page steps aside while they show.
  const browsing = useOcclusion((s) => Object.keys(s.areas).length > 0);
  const stack = useRef<HTMLDivElement>(null);
  useOccludes(toasts.length > 0, () => (stack.current ? boxOf(stack.current.getBoundingClientRect()) : null));
  // Always there, so screen readers hear what arrives in it.
  return (
    <div ref={stack} className={`kasten-toasts${browsing ? " is-left" : ""}`} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useWorkspace((s) => s.dismiss);
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (held || leaving) return;
    const timer = setTimeout(() => setLeaving(true), toast.action ? TOAST_MS.action : TOAST_MS.plain);
    return () => clearTimeout(timer);
  }, [held, leaving, toast.action]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => dismiss(toast.id), TOAST_MS.leave);
    return () => clearTimeout(timer);
  }, [leaving, dismiss, toast.id]);

  return (
    <div
      className={`kasten-toast${leaving ? " is-leaving" : ""}`}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setHeld(false)}
    >
      <span className="kasten-toast-text">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="kasten-toast-action"
          onClick={() => {
            dismiss(toast.id);
            toast.action!.run();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" aria-label="Dismiss" className="kasten-toast-close" onClick={() => setLeaving(true)}>
        <Icon name="close" className="size-3" />
      </button>
    </div>
  );
}
