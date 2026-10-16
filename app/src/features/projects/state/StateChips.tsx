// A project's status and health as small marks, and the menu that changes
// them. Used by the Projects hub, the project's own page and its overview.

import "./state.css";

import { PROJECT_HEALTHS, PROJECT_STATUSES } from "../../../lib/vault/project-types";
import type { NoteMeta } from "../../../lib/vault/types";
import { Menu, type MenuItem } from "../../../shell/Menu";
import { Icon } from "../../../ui/Icon";
import { changeProjectState, type StateChange } from "./state-actions";
import { healthOfProps, statusOfProps, type HealthOrOther, type StatusOrOther } from "./status";

/** The status as a word in a small box: Active is quiet, Paused and Done are tinted. */
export function StatusChip({ status }: { status: StatusOrOther }) {
  return (
    <span className="kasten-state-chip" data-status={status}>
      {status}
    </span>
  );
}

/** The health as a dot and a word, so it never rests on colour alone. */
export function HealthMark({ health }: { health: HealthOrOther }) {
  return (
    <span className="kasten-health" data-health={health} title={`Health: ${health}`}>
      <span className="kasten-health-dot" aria-hidden="true" />
      {health}
    </span>
  );
}

/** The menu items that set a status or a health: the current ones ticked, and a way to clear the health. */
export function stateItems(current: { status: StatusOrOther; health: HealthOrOther | null }, apply: (change: StateChange) => void): (MenuItem | "divider")[] {
  return [
    ...PROJECT_STATUSES.map((status) => ({ label: `Status: ${status}`, checked: current.status === status, onSelect: () => current.status !== status && apply({ status }) })),
    "divider" as const,
    ...PROJECT_HEALTHS.map((health) => ({ label: `Health: ${health}`, checked: current.health === health, onSelect: () => current.health !== health && apply({ health }) })),
    ...(current.health !== null ? [{ label: "Clear health", icon: <Icon name="close" className="size-4" />, onSelect: () => apply({ health: null }) }] : []),
  ];
}

/** A project page's status and health, as one button that opens the menu to change them. */
export function ProjectStateMenu({ project }: { project: Pick<NoteMeta, "path" | "title" | "props" | "kind"> }) {
  const status = statusOfProps(project.props);
  const health = healthOfProps(project.props);
  return (
    <Menu
      label={`Project status: ${status}${health ? `, ${health}` : ""}`}
      align="left"
      float
      buttonClass="kasten-state-button"
      items={stateItems({ status, health }, (change) => void changeProjectState(project, change))}
    >
      <StatusChip status={status} />
      {health && <HealthMark health={health} />}
      <Icon name="chevron-down" className="size-3 text-faint" />
    </Menu>
  );
}
