import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { Icon, type IconName } from "./Icon.tsx";
import { type Anchor, Popover, anchorOf } from "./Popover.tsx";

export type MenuItem =
  | {
      kind?: "item";
      id: string;
      label: string;
      icon?: IconName;
      /** The keys that do the same, such as "Ctrl+Shift+D". */
      keys?: string;
      /** A line under the label that says what the row makes or does, for a menu of things to put on a slide. */
      description?: string;
      /** A check mark before the label: the option that is on. */
      checked?: boolean;
      disabled?: boolean;
      danger?: boolean;
      /** Anything drawn after the label instead of the keys (a colour swatch). */
      trailing?: ReactNode;
      run?(): void;
      items?: MenuItem[];
    }
  | { kind: "separator" }
  | { kind: "heading"; label: string };

interface MenuProps {
  items: MenuItem[];
  anchor: Anchor;
  onClose(): void;
  side?: boolean;
  /** Leave the focus where it is: the menu is used with the mouse over a text editor. */
  keepFocus?: boolean;
  label?: string;
  /** Closes the whole chain of menus, after an item ran. */
  onDone?(): void;
}

const isItem = (item: MenuItem): item is Extract<MenuItem, { id: string }> => item.kind === undefined || item.kind === "item";

/** A list of commands, with sub-menus, check marks and the keys shown. Arrow keys move, Enter runs. */
export function Menu({ items, anchor, onClose, side, keepFocus, label, onDone }: MenuProps) {
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ id: string; anchor: Anchor } | null>(null);
  const finish = onDone ?? onClose;

  useEffect(() => {
    if (!keepFocus) list.current?.focus({ preventScroll: true });
  }, [keepFocus]);

  const buttons = () => [...(list.current?.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)") ?? [])];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at < 0 ? -1 : at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(-1);
    else if (event.key === "ArrowRight" && at >= 0 && all[at]?.dataset.sub) {
      event.preventDefault();
      all[at]!.click();
    } else if (event.key === "ArrowLeft" && side) {
      event.preventDefault();
      onClose();
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      const next = all.find((b, i) => i > at && b.textContent?.toLowerCase().startsWith(event.key.toLowerCase())) ?? all.find((b) => b.textContent?.toLowerCase().startsWith(event.key.toLowerCase()));
      if (next) {
        event.preventDefault();
        next.focus();
      }
    }
  };

  return (
    <Popover anchor={anchor} onClose={onClose} side={side} keepFocus={keepFocus} className="ks-menu" label={label}>
      <div ref={list} className="ks-menu-list" role="menu" tabIndex={-1} onKeyDown={onKeyDown}>
        {items.map((item, i) => {
          if (!isItem(item)) {
            return item.kind === "separator" ? <div key={i} className="ks-menu-sep" role="separator" /> : <div key={i} className="ks-menu-heading">{item.label}</div>;
          }
          const sub = item.items;
          return (
            <Fragment key={item.id}>
              <button
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked}
                aria-haspopup={sub ? "menu" : undefined}
                data-sub={sub ? "1" : undefined}
                className={`ks-menu-item${item.danger ? " is-danger" : ""}${open?.id === item.id ? " is-open" : ""}${item.description ? " has-desc" : ""}`}
                disabled={item.disabled}
                onMouseEnter={(event) => setOpen(sub && !item.disabled ? { id: item.id, anchor: anchorOf(event.currentTarget) } : null)}
                onClick={(event) => {
                  if (sub) setOpen({ id: item.id, anchor: anchorOf(event.currentTarget) });
                  else {
                    finish();
                    item.run?.();
                  }
                }}
              >
                <span className="ks-menu-mark">{item.checked ? <Icon name="check" size={14} /> : item.icon ? <Icon name={item.icon} size={14} /> : null}</span>
                <span className="ks-menu-label">
                  {item.label}
                  {item.description ? <span className="ks-menu-desc">{item.description}</span> : null}
                </span>
                {item.trailing}
                {item.keys ? <kbd className="ks-kbd">{item.keys}</kbd> : null}
                {sub ? <Icon name="chevron-right" size={14} /> : null}
              </button>
              {/* Beside its row, not inside it: a button cannot hold a menu. */}
              {open?.id === item.id && sub ? <Menu items={sub} anchor={open.anchor} side onClose={() => setOpen(null)} onDone={finish} keepFocus={keepFocus} /> : null}
            </Fragment>
          );
        })}
      </div>
    </Popover>
  );
}
