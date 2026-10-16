// Home's reminder for the weekly review. It shows only when it was switched
// on (it is off until then), the chosen weekday has come and no weekly review
// has been marked since. It asks nothing and counts nothing: "Not today"
// puts it off until tomorrow, and a review not done is only a date.

import "./review.css";

import { dayFrom } from "../../lib/dates";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { useWorkspace } from "../workspace/store";
import { lastLine, reminderDue } from "./reminder";
import { useVaultReview } from "./review-prefs";

export function ReviewBanner() {
  const [prefs, change] = useVaultReview();
  const today = dayFrom(0);
  if (!reminderDue(prefs, today)) return null;
  return (
    <div className="kasten-review-banner" role="status" aria-label="Weekly review reminder">
      <Icon name="calendar-check" className="size-4 shrink-0 text-muted" />
      <p>Time for the weekly review. {lastLine("weekly", prefs.last.weekly, today)}.</p>
      <Button size="sm" tone="primary" onClick={() => useWorkspace.getState().go({ view: "reviews", path: "weekly" })}>
        Start
      </Button>
      <Button size="sm" tone="quiet" onClick={() => change({ snoozed: today })}>
        Not today
      </Button>
    </div>
  );
}
