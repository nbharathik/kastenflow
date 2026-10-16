// The small counts above the list: active projects, overdue to-dos, reviews
// due and stale projects. Each one is a button that narrows the list to what
// it counts, and a second press lets go. A count of none is not a button.

import { Icon, type IconName } from "../../../ui/Icon";
import { STALE_DAYS, type Focus, type HubStats, type StatusFilter } from "./hub-model";

interface Props {
  stats: HubStats;
  status: StatusFilter;
  focus: Focus | null;
  onStatus(status: StatusFilter): void;
  onFocus(focus: Focus | null): void;
}

interface StatProps {
  label: string;
  value: number;
  icon: IconName;
  pressed: boolean;
  tone?: "danger";
  title: string;
  onPress(): void;
}

function Stat({ label, value, icon, pressed, tone, title, onPress }: StatProps) {
  return (
    <button type="button" className="kasten-hub-stat" data-tone={value > 0 ? tone : undefined} aria-pressed={pressed} disabled={value === 0 && !pressed} title={title} onClick={onPress}>
      <Icon name={icon} className="size-4" />
      <span className="kasten-hub-stat-value">{value}</span> <span className="kasten-hub-stat-label">{label}</span>
    </button>
  );
}

export function StatStrip({ stats, status, focus, onStatus, onFocus }: Props) {
  const toggle = (next: Focus) => onFocus(focus === next ? null : next);
  return (
    <div role="group" aria-label="Project figures" className="kasten-hub-stats">
      <Stat label="Active projects" value={stats.active} icon="project" pressed={status === "active" && focus === null} title="Show the active projects" onPress={() => onStatus(status === "active" ? "all" : "active")} />
      <Stat
        label="Overdue to-dos"
        value={stats.overdue}
        icon="alert"
        tone="danger"
        pressed={focus === "overdue"}
        title={stats.overdue > 0 ? `Show the ${stats.projectsOverdue === 1 ? "project" : `${stats.projectsOverdue} projects`} with to-dos past their day` : "No to-do is past its day"}
        onPress={() => toggle("overdue")}
      />
      <Stat label="Reviews due" value={stats.reviews} icon="calendar-check" pressed={focus === "review"} title="Show the projects whose review day has come" onPress={() => toggle("review")} />
      <Stat label="Stale" value={stats.stale} icon="clock" pressed={focus === "stale"} title={`Show the active projects nobody touched for ${STALE_DAYS} days`} onPress={() => toggle("stale")} />
    </div>
  );
}
