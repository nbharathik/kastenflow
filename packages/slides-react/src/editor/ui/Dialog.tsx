import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";

import { isSelectAllKey, isTextField, selectRegionText } from "../select-all/dom.ts";
import "./dialog.css";

interface DialogProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  /** Buttons along the bottom edge. */
  footer?: ReactNode;
  width?: number;
  /** The dialog stands at the right edge, so that the slide stays in view beside it. */
  side?: boolean;
  /** The scrim lets go of the page behind it for a while: what the dialog is previewing shows undimmed. */
  clear?: boolean;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** A modal window over the editor. Focus stays inside it, Escape closes it, and focus returns where it was. */
export function Dialog({ title, onClose, children, footer, width = 420, side = false, clear = false }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = box.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select") ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    // Nothing that could take the focus yet (a button still disabled, a dialog of words only): the dialog holds it, so that Escape
    // and Ctrl+A reach it, and a press on its text leaves the focus here instead of dropping it on the page.
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    return () => before?.focus?.();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    } else if (isSelectAllKey(event.nativeEvent) && !isTextField(event.target as Element) && box.current) {
      // Select all in a dialog is the dialog's words, not the page behind it. A field of the dialog selects its own text.
      event.preventDefault();
      selectRegionText(box.current);
    } else if (event.key === "Tab") {
      const all = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = all[0];
      const last = all[all.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className={`ks-scrim${side ? " is-side" : ""}${clear ? " is-clear" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={box} className="ks-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ width }} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="ks-dialog-title">
          {title}
        </h2>
        <div className="ks-dialog-body">{children}</div>
        {footer ? <div className="ks-dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
