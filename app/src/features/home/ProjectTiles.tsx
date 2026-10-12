// Home's Projects section: every project in use as one thin row of chips, in
// the sidebar's order. Nothing else about a project is drawn here: its page has it.

import { useMemo } from "react";

import { IconButton } from "../../ui/Button";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { iconOf, titleOf } from "../workspace/names";
import { useProjectLists } from "../workspace/project-actions";
import { useWorkspace } from "../workspace/store";
import { ChipRow, type Chip } from "./ChipRow";
import { newProject } from "./new-project";

export function ProjectTiles() {
  const { active } = useProjectLists();
  const chips = useMemo<Chip[]>(
    () =>
      active.map((project) => ({
        path: project.path,
        label: titleOf(project),
        icon: <IconOrEmoji icon={iconOf(project)} />,
        open: (how) => useWorkspace.getState().openPath(project.path, how),
      })),
    [active],
  );
  if (chips.length === 0) return null;
  return <ChipRow label="Projects" icon="project" chips={chips} end={<IconButton icon="plus" label="New project" size="sm" onClick={newProject} />} />;
}
