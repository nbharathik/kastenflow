// The menu on a project's card or row: how to open it, its status and health,
// its place in the list, a new update, and archive. The same menu shows from
// the card's "…", a right-click and the menu key.

import type { ProjectSummary } from "../../../lib/vault/project-types";
import type { MenuItem } from "../../../shell/Menu";
import { Icon, type IconName } from "../../../ui/Icon";
import { askToExport } from "../export/request";
import { saveSetupItem } from "../home-menu";
import { changeProjectState } from "../state/state-actions";
import { stateItems } from "../state/StateChips";
import { healthOfProps, statusOfProps } from "../state/status";
import { reviewItems } from "../../review-screens/project/ProjectReviewMenu";
import { refOfSummary } from "../../review-screens/project/refs";
import { archiveProject, openOverviewOf, openPageOf, pageOf, resumeFor, togglePin } from "./hub-actions";

const icon = (name: IconName) => <Icon name={name} className="size-4" />;

export interface CardMenuContext {
  s: ProjectSummary;
  pinned: boolean;
  /** Moving a place earlier or later is allowed (a manual order, nothing filtered out). */
  earlier: boolean;
  later: boolean;
  onShift(step: -1 | 1): void;
  /** Opens the list of tasks to pin as the project's next action. */
  onNextAction(s: ProjectSummary): void;
}

export function cardMenu({ s, pinned, earlier, later, onShift, onNextAction }: CardMenuContext): (MenuItem | "divider")[] {
  const resume = resumeFor(s.folder);
  const page = pageOf(s);
  const current = { status: statusOfProps(page.props), health: healthOfProps(page.props) };
  return [
    { label: "Open overview", icon: icon("expand"), hint: "Enter", onSelect: () => openOverviewOf(s) },
    { label: "Open project page", icon: icon("page"), hint: "Shift+Enter", onSelect: () => openPageOf(s) },
    { label: "Open in new tab", icon: icon("external"), hint: "Ctrl+click", onSelect: () => openOverviewOf(s, "tab") },
    { label: "Open to the right", icon: icon("split"), hint: "Ctrl+Alt+click", onSelect: () => openOverviewOf(s, "right") },
    ...(resume.length > 0 ? ["divider" as const, ...resume.map((r) => ({ label: r.label, icon: icon("restore"), onSelect: r.run }))] : []),
    "divider",
    ...stateItems(current, (change) => void changeProjectState(page, change)),
    "divider",
    { label: pinned ? "Unpin" : "Pin to the top", icon: icon(pinned ? "pin-off" : "pin"), hint: "P", onSelect: () => togglePin(s.folder) },
    ...(earlier ? [{ label: "Move earlier", icon: icon("chevron-up"), hint: "Alt+←", onSelect: () => onShift(-1) }] : []),
    ...(later ? [{ label: "Move later", icon: icon("chevron-down"), hint: "Alt+→", onSelect: () => onShift(1) }] : []),
    "divider",
    // The next action, the review days and a new update: the review pieces' own items.
    ...reviewItems(refOfSummary(s), () => onNextAction(s)),
    "divider",
    // A copy of the project as a folder outside the vault: shown in a dialog before anything is written.
    { label: "Export project…", icon: icon("upload"), onSelect: () => askToExport(s.folder) },
    saveSetupItem(s.folder),
    s.archived
      ? { label: "Unarchive project", icon: icon("restore"), onSelect: () => void archiveProject(s, false) }
      : { label: "Archive project", icon: icon("archive"), onSelect: () => void archiveProject(s, true) },
  ];
}
