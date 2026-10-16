// Settings → Calendar: the day weeks start on, and what the Calendar shows
// on its days, the same switches as its Show menu; then the subscribed
// calendars; then the weekly review's reminder.

import { useVaultReview } from "../review-screens/review-prefs";
import { usePrefs, CALENDAR_SHOW, type WeekStart } from "../workspace/prefs";
import { Group, resetOf, Row, Segmented, Switch } from "../workspace/views/settings/parts";
import { CalendarFeeds } from "./external/CalendarFeeds";
import { SHOW_OPTIONS } from "./show";

const WEEKDAYS = [
  { id: "1", label: "Mon" },
  { id: "2", label: "Tue" },
  { id: "3", label: "Wed" },
  { id: "4", label: "Thu" },
  { id: "5", label: "Fri" },
  { id: "6", label: "Sat" },
  { id: "0", label: "Sun" },
] as const;

export function CalendarSettings() {
  const show = usePrefs((s) => s.calendarShow);
  const weekStart = usePrefs((s) => s.weekStart);
  const [review, changeReview] = useVaultReview();
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
      <Group title="Reviews" sub>
        <Switch id="calendar.reviewReminder" usual={false} checked={review.remind} onChange={(remind) => changeReview({ remind, snoozed: null })} />
        <Row id="calendar.reviewDay" {...resetOf(String(review.weekday), "5", (day) => changeReview({ weekday: Number(day) }))}>
          <Segmented<"1" | "2" | "3" | "4" | "5" | "6" | "0"> label="Reminder day" value={String(review.weekday) as "1"} options={[...WEEKDAYS]} onChange={(day) => changeReview({ weekday: Number(day) })} />
        </Row>
      </Group>
    </>
  );
}
