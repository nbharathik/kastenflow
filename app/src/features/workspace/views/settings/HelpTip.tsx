// The small ? beside a setting's name: the longer explanation, kept out of the
// row until asked for. It opens on a click or Enter (and stays), or on hover,
// and Escape or a click elsewhere closes it.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { usePresence } from "../../../../lib/presence";
import { Icon } from "../../../../ui/Icon";

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = pinned || hover;
  // The note fades out for a moment after it is closed.
  const { present, state } = usePresence(open, 90);
  const shown = useRef(children);
  if (open) shown.current = children;

  useEffect(() => {
    if (!pinned) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [pinned]);

  return (
    <span
      ref={box}
      className="kasten-set-help"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setPinned(false);
        setHover(false);
      }}
    >
      <button type="button" className="kasten-set-help-button" aria-label={`About ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setPinned((was) => !was)}>
        <Icon name="help" className="size-[14px]" />
      </button>
      {present && (
        <span id={id} role="status" data-state={state} className="kasten-set-pop">
          {shown.current}
        </span>
      )}
    </span>
  );
}
