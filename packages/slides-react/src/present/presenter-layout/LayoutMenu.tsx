// The "Layout" menu of the presenter's header: which panels show, the presets, and the side the slide is on. A plain button and a list
// (the presenter's window is a page of its own, without the editor's popovers).

import { type JSX, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { type Panel, PRESETS, isLastPanel } from "./layout.ts";
import type { LayoutControls } from "./useLayout.ts";

const PANELS: readonly { panel: Panel | "clock"; label: string }[] = [
  { panel: "now", label: "Current slide" },
  { panel: "next", label: "Next slide" },
  { panel: "notes", label: "Notes" },
  { panel: "clock", label: "Timer and clock" },
];

export function LayoutMenu({ controls }: { controls: LayoutControls }): JSX.Element {
  const { layout } = controls;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const away = (event: Event) => {
      if (event.target instanceof Node && !box.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey) return;
    // Keys inside the menu are the menu's: space and the arrows must not also move the talk on.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = [...(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };

  const item = (label: string, checked: boolean | null, onClick: () => void, extra: { disabled?: boolean; radio?: boolean; closes?: boolean } = {}) => (
    <button
      key={label}
      type="button"
      role={checked === null ? "menuitem" : extra.radio ? "menuitemradio" : "menuitemcheckbox"}
      {...(checked === null ? {} : { "aria-checked": checked })}
      aria-disabled={extra.disabled || undefined}
      className="ks-pv-menu-item"
      onClick={() => {
        if (extra.disabled) return;
        onClick();
        if (extra.closes) setOpen(false);
      }}
    >
      <span className="ks-pv-menu-mark" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      {label}
    </button>
  );

  return (
    <div ref={box} className="ks-pv-layout" onKeyDown={keys}>
      <button ref={button} type="button" className="ks-pv-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Layout
      </button>
      {open ? (
        <div role="menu" aria-label="Layout" className="ks-pv-menu">
          {PANELS.map(({ panel, label }) => item(label, layout.show[panel], () => controls.toggle(panel), { disabled: panel !== "clock" && isLastPanel(layout, panel) }))}
          {item("Next two steps", layout.then, controls.toggleThen)}
          <hr className="ks-pv-menu-rule" />
          {PRESETS.map(({ name, label }) => item(label, layout.preset === name, () => controls.preset(name), { radio: true, closes: true }))}
          {item("Swap sides", layout.swap, controls.toggleSwap)}
          <hr className="ks-pv-menu-rule" />
          {item("Reset layout", null, controls.reset, { closes: true })}
        </div>
      ) : null}
    </div>
  );
}
