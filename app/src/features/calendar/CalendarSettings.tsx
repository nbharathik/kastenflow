// Settings → Calendar: the day weeks start on, and what the Calendar shows
// on its days, the same switches as its Show menu; then the subscribed
// calendars.

import { usePrefs, CALENDAR_SHOW, type WeekStart } from "../workspace/prefs";
import { Group, resetOf, Row, Segmented, Switch } from "../workspace/views/settings/parts";
import { CalendarFeeds } from "./external/CalendarFeeds";
import { SHOW_OPTIONS } from "./show";

export function CalendarSettings() {
  const show = usePrefs((s) => s.calendarShow);
  const weekStart = usePrefs((s) => s.weekStart);
  return (
    <>
      <Group title="Calendar">
        <Row id="calendar.weekStart" {...resetOf(String(weekStart), "1", (day) => usePrefs.getState().set({ weekStart: Number(day) as WeekStart }))}>
          <Segmented<"1" | "0" | "6">
            label="Weeks start on"
            value={String(weekStart) as "1" | "0" | "6"}
            options={[
              { id: "1", label: "Monday" },
              { id: "0", label: "Sunday" },
              { id: "6", label: "Saturday" },
            ]}
            onChange={(day) => usePrefs.getState().set({ weekStart: Number(day) as WeekStart })}
          />
        </Row>
        {SHOW_OPTIONS.map((option) => (
          <Switch
            key={option.key}
            id={`calendar.show.${option.key}`}
            usual={CALENDAR_SHOW[option.key]}
            checked={show[option.key]}
            onChange={(on) => usePrefs.getState().set({ calendarShow: { ...usePrefs.getState().calendarShow, [option.key]: on } })}
          />
        ))}
      </Group>
      <CalendarFeeds />
    </>
  );
}
