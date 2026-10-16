// Home's Projects section: the projects in use as one thin row of chips, the
// pinned ones first and then the one changed most recently, with "Paused" or
// "Done" after the name of one that is. A chip opens the project; "All projects"
// opens the Projects hub. Nothing else about a project is drawn here.

import { useMemo } from "react";

import { IconButton } from "../../ui/Button";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { useSummaries } from "../projects/hub/use-summaries";
import { isDormant, statusOfProps } from "../projects/state/status";
import { iconOf, titleOf } from "../workspace/names";
import { usePrefs } from "../workspace/prefs";
import { useProjectLists } from "../workspace/project-actions";
import { projectKey } from "../workspace/project-order";
import { howFrom, useWorkspace } from "../workspace/store";
import { ChipRow, type Chip } from "./ChipRow";
import { newProject } from "./new-project";

export function ProjectTiles() {
  const { active } = useProjectLists();
  const { list } = useSummaries();
  const pinnedProjects = usePrefs((s) => s.pinnedProjects);
  const chips = useMemo<Chip[]>(() => {
    const touched = new Map((list ?? []).map((s) => [s.folder, s.latest?.modified ?? 0]));
    const pins = new Set(pinnedProjects);
    // The sidebar's arrangement already puts the pinned first; the rest follow the newest change.
    const ordered = list ? [...active.filter((p) => pins.has(projectKey(p))), ...active.filter((p) => !pins.has(projectKey(p))).sort((a, b) => (touched.get(projectKey(b)) ?? 0) - (touched.get(projectKey(a)) ?? 0))] : active;
    return ordered.map((project) => {
      const status = statusOfProps(project.props);
      return {
        path: project.path,
        label: titleOf(project),
        icon: <IconOrEmoji icon={iconOf(project)} />,
        ...(isDormant(status) ? { detail: status } : {}),
        open: (how) => useWorkspace.getState().openPath(project.path, how),
      };
    });
  }, [active, list, pinnedProjects]);
  if (chips.length === 0) return null;
  return (
    <ChipRow
      label="Projects"
      icon="project"
      chips={chips}
      end={
        <>
          <button type="button" className="kasten-home-chip is-more" onClick={(event) => useWorkspace.getState().go({ view: "projects" }, howFrom(event))}>
            All projects
          </button>
          <IconButton icon="plus" label="New project" size="sm" onClick={newProject} />
        </>
      }
    />
  );
}
