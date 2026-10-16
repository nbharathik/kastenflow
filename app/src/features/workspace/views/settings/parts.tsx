// Building blocks for Settings: a card of rows, a row (a name, a ? for the
// longer explanation, the control, and a dot with a way back when it differs
// from the usual), switches and segmented choices, in the window's accent.
// A row names its entry in the index (`id`) and takes its label and
// explanation from there; while a search is on, rows that were not found hide
// and the words that were found are marked.

import type { ReactNode } from "react";

import { IconButton } from "../../../../ui/Button";
import { Icon, type IconName } from "../../../../ui/Icon";
import { Segmented as Kit } from "../../../../ui/Segmented";
import { HelpTip } from "./HelpTip";
import { groupById, rowDomId, sectionId, type SettingEntry } from "./index";
import { pieces } from "./search";
import { cardDrawn, drawn, entryOf, useSettingsView } from "./view";

/** A text under a row's name longer than this goes behind the ? instead. */
const SHORT = 64;

/** `text`, with the words the search found marked. */
export function Marked({ text }: { text: string }) {
  const { words } = useSettingsView();
  if (words.length === 0) return <>{text}</>;
  return (
    <>
      {pieces(text, words).map((piece, i) =>
        piece.hit ? (
          <mark key={i} className="kasten-set-mark">
            {piece.text}
          </mark>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </>
  );
}

/** One card of a group's page. `sub` gives it a small heading (a page with several cards).
 * `found` draws it in search results although none of its entries matched: the card has
 * something of its own to show (shortcut commands found by name). */
export function Group({ title, sub = false, help, found = false, children }: { title: string; sub?: boolean; help?: ReactNode; found?: boolean; children: ReactNode }) {
  const view = useSettingsView();
  if (!found && !cardDrawn(view, title)) return null;
  return (
    <section id={sectionId(title)} aria-label={title} className="kasten-set-group">
      {sub && (
        <div className="kasten-set-sub">
          <h3>{title}</h3>
          {help && <HelpTip label={title}>{help}</HelpTip>}
        </div>
      )}
      <div className="kasten-set-card">{children}</div>
    </section>
  );
}

/** The usual value of a setting, for the dot and the way back. */
export function resetOf<T extends string | number | boolean>(value: T, usual: T, set: (value: T) => void): { modified: boolean; onReset: () => void } {
  return { modified: value !== usual, onReset: () => set(usual) };
}

interface RowProps {
  /** The setting's entry in the index: its label and explanation come from there. */
  id?: string;
  label?: string;
  /** One short line under the name: a status. A long text goes behind the ? instead. */
  detail?: ReactNode;
  /** The longer explanation, behind the ? . */
  help?: ReactNode;
  icon?: IconName;
  /** The setting differs from the usual: shows the dot, and the way back if `onReset` is given. */
  modified?: boolean;
  onReset?: () => void;
  /** The control goes under the name, over the whole width. */
  stacked?: boolean;
  children?: ReactNode;
}

export function Row({ id, label, detail, help, icon, modified = false, onReset, stacked = false, children }: RowProps) {
  const view = useSettingsView();
  if (!drawn(view, id)) return null;
  const entry = entryOf(id);
  if (entry?.jump && view.matching !== null) return <Hit entry={entry} />;
  const name = label ?? entry?.label ?? "";
  const long = typeof detail === "string" && detail.length > SHORT ? detail : null;
  const note = long ? null : detail;
  // What the caller says in context beats the index's general explanation.
  const explanation = help ?? long ?? entry?.help;
  const searching = view.matching !== null;
  const why = searching && typeof explanation === "string" ? explanation : null;
  // Words found only among the entry's other names: say which, so the row's showing is no mystery.
  const shown = `${name} ${typeof explanation === "string" ? explanation : ""} ${entry ? groupById(entry.group).title : ""} ${entry?.card ?? ""}`.toLowerCase();
  const also = searching && entry?.words ? view.words.filter((w) => !shown.includes(w) && entry.words!.toLowerCase().includes(w)) : [];
  return (
    <div id={id ? rowDomId(id) : undefined} data-setting={id} className={`kasten-set-row${stacked ? " is-stacked" : ""}${id && view.flash === id ? " is-flash" : ""}`}>
      <div className="kasten-set-text">
        <div className="kasten-set-label">
          {modified && <span role="img" aria-label="Changed from the usual" title="Changed from the usual" className="kasten-set-dot" />}
          {icon && <Icon name={icon} className="kasten-set-icon" />}
          <span className="kasten-set-name">
            <Marked text={name} />
          </span>
          {explanation && <HelpTip label={name}>{explanation}</HelpTip>}
          {modified && onReset && <IconButton icon="undo" label={`Reset ${name}`} title="Back to the usual" size="sm" onClick={onReset} />}
        </div>
        {why && (
          <div className="kasten-set-why">
            <Marked text={why} />
          </div>
        )}
        {also.length > 0 && (
          <div className="kasten-set-why">
            Also known as{" "}
            {also.map((word) => (
              <mark key={word} className="kasten-set-mark">
                {word}
              </mark>
            ))}
          </div>
        )}
        {note && <div className="kasten-set-detail">{note}</div>}
      </div>
      {children && <div className="kasten-set-control">{children}</div>}
    </div>
  );
}

/** A complex piece of a group (a list, a form) that is not one row. `titled`
 * gives it its entry's label as a heading, with the explanation behind a ?.
 * While a search is on it shows only if found; a jump entry shows as a line
 * that opens it. */
export function Block({ id, titled = false, children }: { id: string; titled?: boolean; children: ReactNode }) {
  const view = useSettingsView();
  if (!drawn(view, id)) return null;
  const entry = entryOf(id);
  if (view.matching !== null && entry?.jump) return <Hit entry={entry} />;
  return (
    <div id={rowDomId(id)} data-setting={id} className={`kasten-set-block${view.flash === id ? " is-flash" : ""}`}>
      {titled && entry && (
        <div className="kasten-set-label kasten-set-form-title">
          <span className="kasten-set-name">
            <Marked text={entry.label} />
          </span>
          {entry.help && <HelpTip label={entry.label}>{entry.help}</HelpTip>}
        </div>
      )}
      {children}
    </div>
  );
}

/** More under a row, such as the list a row's switch controls: not drawn in search results. */
export function Extra({ children }: { children: ReactNode }) {
  const view = useSettingsView();
  return view.matching === null ? <div className="kasten-set-extra">{children}</div> : null;
}

/** A found setting that is too big to draw in the results: a line that opens its group at it. */
function Hit({ entry }: { entry: SettingEntry }) {
  const view = useSettingsView();
  return (
    <button type="button" className="kasten-set-hit" aria-label={`Open ${entry.label} in ${groupById(entry.group).title}`} onClick={() => view.open(entry.id)}>
      <span className="kasten-set-hit-text">
        <span className="kasten-set-name">
          <Marked text={entry.label} />
        </span>
        {entry.help && (
          <span className="kasten-set-why">
            <Marked text={entry.help} />
          </span>
        )}
      </span>
      <Icon name="chevron" className="size-3.5 text-muted" />
    </button>
  );
}

/** A line of quiet words in a card: what is going on, or what to do next. */
export function Note({ children, tone }: { children: ReactNode; tone?: "danger" | "warning" }) {
  const view = useSettingsView();
  if (view.matching !== null) return null;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`kasten-set-note${tone ? ` is-${tone}` : ""}`}>
      {children}
    </div>
  );
}

/** A checkbox drawn as a switch. `usual` is the value it starts with, for the dot. */
export function Switch({ id, label, help, detail, icon, checked, onChange, usual }: { id?: string; label?: string; help?: ReactNode; detail?: string; icon?: IconName; checked: boolean; onChange: (value: boolean) => void; usual?: boolean }) {
  const name = label ?? entryOf(id)?.label ?? "";
  return (
    <Row id={id} label={label} help={help} detail={detail} icon={icon} {...(usual === undefined ? {} : resetOf(checked, usual, onChange))}>
      <label className="relative inline-flex cursor-pointer items-center">
        <input type="checkbox" role="switch" aria-label={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        {/* The knob takes the accent's own text colour when on, so it shows on a light accent too. */}
        <span className="h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40" />
        <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-knob shadow transition-transform peer-checked:translate-x-4 peer-checked:bg-on-accent" />
      </label>
    </Row>
  );
}

/** A few choices side by side, one picked: the kit's segmented control,
 * as a radio group. */
export function Segmented<T extends string>({ label, value, options, onChange, iconsOnly = false }: { label: string; value: T; options: { id: T; label: string; icon?: IconName }[]; onChange: (value: T) => void; iconsOnly?: boolean }) {
  return <Kit radio iconsOnly={iconsOnly} label={label} value={value} choices={options.map((o) => ({ value: o.id, label: o.label, icon: o.icon }))} onChange={onChange} />;
}
