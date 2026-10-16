// "Resume workspace" for a project: the tab sets linked to it (TabSets, "Link
// to project"), one button when there is a set and a menu when there are
// several. Nothing shows for a project with none. The projects hub and the
// project overview both use it.

import { Menu } from "../../shell/Menu";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { usePrefs } from "./prefs";
import { setsOfProject } from "./tab-sets";
import { resumeSet } from "./workspaces";

export function ResumeWorkspace({ folder, size = "md" }: { folder: string; size?: "sm" | "md" }) {
  const sets = usePrefs((s) => s.tabSets);
  const mine = setsOfProject(sets, folder);
  if (mine.length === 0) return null;
  if (mine.length === 1) {
    return (
      <Button icon="layers" size={size} onClick={() => resumeSet(mine[0]!)}>
        Resume workspace
      </Button>
    );
  }
  return (
    <Menu label="Resume workspace" items={mine.map((set) => ({ label: set.name, icon: <Icon name="layers" className="size-4" />, onSelect: () => resumeSet(set) }))} buttonClass={`ui-btn${size === "sm" ? " is-sm" : ""}`}>
      <Icon name="layers" className="size-4" />
      Resume workspace
    </Menu>
  );
}
