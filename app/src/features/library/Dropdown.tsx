import "../pages/editor/styles/tokens.css";
import "../pages/page/popups.css";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon } from "../../ui/Icon";
import { Popup } from "../pages/page/Popup";

export interface DropdownOption {
  value: string;
  label: string;
  /** Small text at the right, such as a count. */
  detail?: string;
  /** A heading above this option when it starts a new group of options. */
  group?: string;
}

export interface DropdownProps {
  /** The control's name, read out with what it shows: "Project". */
  label: string;
  value: string;
  options: readonly DropdownOption[];
  onChange(value: string): void;
  /** What the button says; by default the chosen option's label. */
  display?: string;
  /** Not the default choice: the button shows as set. */
  active?: boolean;
  /** A box to type in, to narrow a long list; by default shown for more than eight options. */
  filterable?: boolean;
  /** Under the list, such as fields for a month or a range; closes the popup when asked. */
  footer?: (close: () => void) => ReactNode;
}

const control = "h-8 rounded-lg border text-13 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50";
const idle = "border-line bg-raised text-ink hover:bg-hover";
const set = "border-accent/55 bg-accent/12 font-medium text-accent";

/** A themed drop-down in place of the browser's select: a button that opens a
 * list under it, narrowed as you type when it is long. ↑ ↓ Home End move, Enter
 * or a click chooses, Esc closes. */
export function Dropdown({ label, value, options, onChange, display, active = false, filterable, footer }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const text = display ?? options.find((o) => o.value === value)?.label ?? value;
  return (
    <span className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${text}`}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
        }}
        className={`${control} ${active ? set : idle} flex max-w-[13rem] cursor-pointer items-center gap-1.5 pl-2.5 pr-2`}
      >
        <span className="truncate">{text}</span>
        <Icon name="chevron" className={`size-3.5 shrink-0 rotate-90 ${active ? "text-accent" : "text-muted"}`} />
      </button>
      {open && (
        <Popup label={label} anchor={button} onClose={() => setOpen(false)} className="top-full mt-1 w-64 max-w-[calc(100vw-1rem)] overflow-hidden">
          <Panel label={label} value={value} options={options} filterable={filterable ?? options.length > 8} footer={footer} onPick={(v) => onChange(v)} close={() => setOpen(false)} />
        </Popup>
      )}
    </span>
  );
}

interface PanelProps {
  label: string;
  value: string;
  options: readonly DropdownOption[];
  filterable: boolean;
  footer?: (close: () => void) => ReactNode;
  onPick(value: string): void;
  close(): void;
}

function Panel({ label, value, options, filterable, footer, onPick, close }: PanelProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  const [asked, setAsked] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const q = typed.trim().toLowerCase();
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q) || o.detail?.toLowerCase().includes(q));
  const current = Math.min(asked, Math.max(0, shown.length - 1));

  // Near the right edge the list opens toward the left instead of off the window.
  useLayoutEffect(() => {
    const popup = root.current?.parentElement;
    if (!popup) return;
    popup.style.left = "0";
    popup.style.right = "";
    if (popup.getBoundingClientRect().right > window.innerWidth - 8) {
      popup.style.left = "auto";
      popup.style.right = "0";
    }
  }, []);
  useEffect(() => {
    document.getElementById(`${id}-${current}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, current]);

  const choose = (index: number) => {
    const option = shown[index];
    if (!option) return;
    onPick(option.value);
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const key = event.key;
    if (key === "ArrowDown") setAsked(Math.min(current + 1, shown.length - 1));
    else if (key === "ArrowUp") setAsked(Math.max(current - 1, 0));
    else if (key === "Home" && !filterable) setAsked(0);
    else if (key === "End" && !filterable) setAsked(shown.length - 1);
    else if (key === "Enter") choose(current);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    // Esc closes the list only, not the selection or view behind it.
    <div ref={root} onKeyDown={(event) => event.key === "Escape" && event.stopPropagation()}>
      <div onKeyDown={onKeyDown}>
        {filterable && (
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Icon name="search" className="size-4 text-muted" />
            <input
              autoFocus
              value={typed}
              aria-label={`Find in ${label}`}
              aria-controls={`${id}-list`}
              aria-activedescendant={shown.length > 0 ? `${id}-${current}` : undefined}
              placeholder="Type to filter…"
              onChange={(event) => {
                setTyped(event.target.value);
                setAsked(0);
              }}
              className="h-9 min-w-0 flex-1 bg-transparent text-13 outline-none placeholder:text-muted"
            />
          </div>
        )}
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          tabIndex={filterable ? -1 : 0}
          aria-activedescendant={!filterable && shown.length > 0 ? `${id}-${current}` : undefined}
          className="max-h-64 overflow-y-auto p-1 outline-none"
        >
          {shown.length === 0 && <p className="px-2.5 py-2 text-13 text-muted">Nothing matches</p>}
          {shown.map((option, i) => (
            <div key={option.value} role="presentation">
              {option.group !== undefined && option.group !== shown[i - 1]?.group && (
                <p aria-hidden="true" className="px-2 pb-0.5 pt-2 text-12 font-medium text-muted">
                  {option.group}
                </p>
              )}
              <div
                id={`${id}-${i}`}
                role="option"
                aria-selected={option.value === value}
                onMouseMove={() => asked !== i && setAsked(i)}
                onClick={() => choose(i)}
                className={`flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-13 ${i === current ? "bg-hover" : ""}`}
              >
                <span className="grid w-4 place-items-center text-accent" aria-hidden="true">
                  {option.value === value && <Icon name="check" className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.detail && <span className="shrink-0 text-12 text-muted">{option.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
      {footer?.(close)}
    </div>
  );
}
