import "./title-date.css";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { longDay, shortDay } from "../../../lib/dates";
import { lineIconName } from "../../../ui/glyph";
import { Icon } from "../../../ui/Icon";
import { CoverPicker } from "./CoverPicker";
import { coverBackground, randomCover } from "./covers";
import { EmojiPicker } from "./EmojiPicker";
import { iconGlyph, randomEmoji } from "./emoji";
import type { MetaKey, PageMeta } from "./page-meta";
import { atQuery, DateMenu, withoutAt } from "./title-date";

export interface PageHeaderProps {
  meta: PageMeta;
  /** Sets a frontmatter field; `null` removes it. */
  onChange: (key: MetaKey, value: string | null) => void;
  /** Enter in the title moves into the page, as in Notion. */
  onEnterBody: () => void;
  /** The title field lost focus or took Enter: time to commit a new title. */
  onTitleDone?: () => void;
  /** Journal days are named by their date. */
  titleReadOnly?: boolean;
  /** Puts the caret in the title, for a page just created. */
  autoFocusTitle?: boolean;
  /** Offers to put the page somewhere else (a project, under a page), with
   * where it is now, e.g. "Library": only on an empty page. */
  place?: { label: string; onMove: () => void };
  /** Offers to add a property, when the page shows none under its title. */
  onAddProperty?: () => void;
  /** A page with nothing in it yet: its controls show without a hover. */
  fresh?: boolean;
  /** Keeps a picture with the vault for a cover, and shows kept pictures. */
  files?: { save: (file: File) => Promise<string>; url: (src: string) => string };
  /** The page's date (`YYYY-MM-DD`), shown as a chip beside the title. */
  date?: string | null;
  /** Typing `@` in the title offers dates; a pick sets the page's date, and
   * the chip's remove button clears it (null). Without it the title has no `@` menu. */
  onDate?: (day: string | null) => void;
  /** The day weeks start on, for dates such as "next week". */
  weekStart?: () => number;
}

/** Notion's page header: cover, icon, and a big title, all from the frontmatter. */
export function PageHeader({ meta, onChange, onEnterBody, onTitleDone, titleReadOnly, autoFocusTitle, place, onAddProperty, fresh, files, date, onDate, weekStart }: PageHeaderProps) {
  const [picker, setPicker] = useState<"icon" | "cover" | null>(null);
  const background = coverBackground(meta.cover, files?.url);
  const glyph = iconGlyph(meta.icon);
  // One of the app's line icons ("icon:project"), drawn; else the emoji.
  const line = lineIconName(glyph);
  const classes = ["kasten-page-header", background ? "has-cover" : "", glyph ? "has-icon" : "", fresh ? "is-fresh" : ""].filter(Boolean);

  return (
    <header className={classes.join(" ")}>
      {background && (
        <div className="kasten-page-cover" style={{ background }}>
          <div className="kasten-page-cover-actions">
            <button type="button" aria-label="Change cover" title="Change cover" onClick={() => setPicker("cover")}>
              <Icon name="image" className="size-4" />
            </button>
            <button type="button" aria-label="Remove cover" title="Remove cover" onClick={() => onChange("cover", null)}>
              <Icon name="close" className="size-4" />
            </button>
          </div>
          {picker === "cover" && (
            <CoverPicker
              onPick={(cover) => {
                onChange("cover", cover);
                setPicker(null);
              }}
              onRemove={() => {
                onChange("cover", null);
                setPicker(null);
              }}
              onClose={() => setPicker(null)}
              onUpload={files?.save}
            />
          )}
        </div>
      )}
      <div className="kasten-page-column kasten-page-heading">
        {glyph && (
          <div className="kasten-page-icon-wrap">
            <button type="button" className="kasten-page-icon" aria-label="Change icon" title={line ? undefined : meta.icon} onClick={() => setPicker("icon")}>
              {line ? <Icon name={line} className="size-[calc(5em/6)] text-muted" strokeWidth={1.25} /> : glyph}
            </button>
            {picker === "icon" && (
              <EmojiPicker
                onPick={(emoji) => {
                  onChange("icon", emoji);
                  setPicker(null);
                }}
                onRemove={() => {
                  onChange("icon", null);
                  setPicker(null);
                }}
                onClose={() => setPicker(null)}
              />
            )}
          </div>
        )}
        <div className="kasten-page-controls">
          {/* Icons, no words: the name and the tooltip say what each does. "In … · Move" keeps its words: it says where the page is. */}
          {!glyph && (
            <button type="button" className="is-icon" aria-label="Add icon" title="Add icon" onClick={() => onChange("icon", randomEmoji())}>
              <Icon name="smile" className="size-4" />
            </button>
          )}
          {!background && (
            <button type="button" className="is-icon" aria-label="Add cover" title="Add cover" onClick={() => onChange("cover", randomCover())}>
              <Icon name="image" className="size-4" />
            </button>
          )}
          {onAddProperty && (
            <button type="button" className="is-icon" aria-label="Add property" title="Add property" onClick={onAddProperty}>
              <Icon name="list-plus" className="size-4" />
            </button>
          )}
          {place && (
            <button type="button" onClick={place.onMove} title="Put this page in another project or in Pages">
              <Icon name="folder" className="size-4" /> In {place.label} · Move
            </button>
          )}
        </div>
        <div className={`kasten-page-title-row${date ? " has-date" : ""}`}>
          <TitleField
            value={meta.title}
            onChange={(title) => onChange("title", title)}
            onEnter={onEnterBody}
            onDone={onTitleDone}
            readOnly={titleReadOnly}
            autoFocus={autoFocusTitle}
            onDate={onDate}
            weekStart={weekStart}
          />
          {date && (
            <div className="kasten-page-date-slot">
              <span className="kasten-page-date" role="group" aria-label={`Date: ${longDay(date)}`}>
                <Icon name="calendar" className="size-3.5" />
                {shortDay(date)}
                {onDate && (
                  <button type="button" aria-label="Remove date" title="Remove date" onClick={() => onDate(null)}>
                    <Icon name="close" className="size-3" />
                  </button>
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** The title: one paragraph of plain text that wraps and grows. */
interface TitleFieldProps {
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  onDone?: () => void;
  readOnly?: boolean;
  autoFocus?: boolean;
  onDate?: (day: string | null) => void;
  weekStart?: () => number;
}

/** Webviews that size a text area to its text themselves (CSS
 * `field-sizing: content`), with no layout forced from script. */
const SIZES_ITSELF = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

function TitleField({ value, onChange, onEnter, onDone, readOnly, autoFocus, onDate, weekStart }: TitleFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // The date menu for an `@` typed in the title, which reads the latest props.
  const menu = useRef<DateMenu | null>(null);
  const latest = useRef({ onChange, onDate, weekStart });
  useEffect(() => {
    latest.current = { onChange, onDate, weekStart };
  });
  useEffect(() => () => menu.current?.close(), []);
  const pick = (day: string) => {
    const field = ref.current;
    if (!field) return;
    const caret = field.selectionStart ?? field.value.length;
    const at = atQuery(field.value, caret);
    const title = at ? withoutAt(field.value, at.from, caret) : field.value;
    latest.current.onChange(title);
    latest.current.onDate?.(day);
    // The title is set again on the next render, which moves the caret to its end.
    const place = Math.min(at?.from ?? title.length, title.length);
    setTimeout(() => field.setSelectionRange(place, place), 0);
  };
  const watch = (field: HTMLTextAreaElement) => {
    if (!onDate || readOnly) return;
    const at = atQuery(field.value, field.selectionStart ?? field.value.length);
    if (!at) return menu.current?.close();
    menu.current ??= new DateMenu(
      () => ref.current?.getBoundingClientRect() ?? { left: 0, top: 0, right: 0, bottom: 0 },
      () => latest.current.weekStart?.() ?? 1,
      pick,
    );
    menu.current.show(at.query);
  };
  useLayoutEffect(() => {
    const field = ref.current;
    // Reading scrollHeight lays out the whole new page before it paints.
    if (!field || SIZES_ITSELF) return;
    const fit = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    };
    fit();
    // The column narrows when a panel opens, and fonts load late: refit then.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    observer?.observe(field.parentElement ?? field);
    void document.fonts?.ready.then(fit);
    return () => observer?.disconnect();
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      className="kasten-page-title"
      placeholder="Untitled"
      aria-label="Page title"
      spellCheck
      readOnly={readOnly}
      value={value}
      onChange={(event) => {
        onChange(event.target.value.replace(/\s*[\r\n]+\s*/g, " "));
        watch(event.target);
      }}
      onSelect={(event) => watch(event.currentTarget)}
      onBlur={() => {
        menu.current?.close();
        onDone?.();
      }}
      onKeyDown={(event) => {
        if (menu.current?.isOpen && menu.current.handleKey(event.nativeEvent)) return event.preventDefault();
        const field = event.currentTarget;
        const atEnd = field.selectionStart === field.value.length;
        if (event.key === "Enter" || (event.key === "ArrowDown" && atEnd)) {
          event.preventDefault();
          onDone?.();
          onEnter();
        }
      }}
    />
  );
}
