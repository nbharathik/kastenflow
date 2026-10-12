// The header's Show menu: which kinds of things the Calendar puts on its
// days, and which subscribed calendars. Each is a switch that keeps the menu
// open; Settings has the same.

import { useRef, useState } from "react";

import { useWorkspace } from "../workspace/store";
import { Icon } from "../../ui/Icon";
import { Popup } from "../pages/page/Popup";
import { usePrefs } from "../workspace/prefs";
import { swatch } from "../panel/properties/schemas";
import { useCalendars, useFeeds } from "./external/store";
import { hiddenCalendars, hiddenCount, SHOW_OPTIONS } from "./show";

export function ShowMenu() {
  const show = usePrefs((s) => s.calendarShow);
  const calendars = useCalendars();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const hidden = hiddenCount(show) + hiddenCalendars(calendars);
  const flip = (id: string, shown: boolean) =>
    useFeeds
      .getState()
      .edit(id, { shown })
      .catch((error: unknown) => useWorkspace.getState().toast(error instanceof Error ? error.message : String(error)));
  return (
    <span className="relative inline-flex">
      <button
        ref={button}
        type="button"
        className="kasten-cal-today kasten-cal-show"
        aria-expanded={open}
        aria-haspopup="true"
        title="What the calendar shows"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="eye" className="size-4" />
        Show
        {hidden > 0 && <span className="kasten-cal-show-count" aria-label={`${hidden} hidden`}>{hidden}</span>}
      </button>
      {open && (
        <Popup label="Show on the calendar" anchor={button} onClose={() => setOpen(false)} className="kasten-cal-showmenu">
          <p className="kasten-cal-showmenu-head">Show on the calendar</p>
          {SHOW_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={show[option.key]}
              className="kasten-cal-showmenu-item"
              onClick={() => usePrefs.getState().set({ calendarShow: { ...usePrefs.getState().calendarShow, [option.key]: !show[option.key] } })}
            >
              <span className="kasten-cal-showmenu-check" aria-hidden="true">
                {show[option.key] && <Icon name="check" className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">{option.label}</span>
                <span className="kasten-cal-showmenu-detail">{option.detail}</span>
              </span>
            </button>
          ))}
          {calendars && calendars.length > 0 && (
            <>
              <p className="kasten-cal-showmenu-head kasten-cal-showmenu-sub">Subscribed calendars</p>
              {calendars.map((calendar) => (
                <button
                  key={calendar.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={calendar.shown}
                  className="kasten-cal-showmenu-item"
                  onClick={() => void flip(calendar.id, !calendar.shown)}
                >
                  <span className="kasten-cal-showmenu-check" aria-hidden="true">
                    {calendar.shown && <Icon name="check" className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block">
                      <span className="kasten-cal-showmenu-dot" style={{ background: swatch(calendar.color)?.fg ?? "var(--color-accent)" }} aria-hidden="true" />
                      {calendar.name}
                    </span>
                    <span className="kasten-cal-showmenu-detail">{calendar.host}</span>
                  </span>
                </button>
              ))}
            </>
          )}
        </Popup>
      )}
    </span>
  );
}
