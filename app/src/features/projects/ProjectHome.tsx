// A project's home: a dashboard at the top of its project page,
// above the page's own text. Each project picks and orders its sections
// (Customize), folds the home away for a while, or hides it for good (its
// `home` property; the page menu shows it again).

import "../dashboard/dashboard.css";

import { useState } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { Customize } from "../dashboard/Customize";
import { DashEmpty, DashGrid } from "../dashboard/DashCard";
import { howFrom } from "../workspace/store";
import { PROJECT_DEFAULT, PROJECT_SECTIONS, projectHome } from "./home";
import { saveHome } from "./home-actions";
import { openOverview } from "./overview/open";
import { ProjectSection } from "./ProjectSections";

const FOLD_KEY = "kasten.project-home.folded";

function foldedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Whether this project's home is folded, remembered in this window. */
function useFolded(folder: string): [boolean, (folded: boolean) => void] {
  const [folded, setFolded] = useState(() => foldedSet().has(folder));
  const set = (next: boolean) => {
    setFolded(next);
    const all = foldedSet();
    if (next) all.add(folder);
    else all.delete(folder);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify([...all]));
    } catch {
      // Unfolded next time.
    }
  };
  return [folded, set];
}

export function ProjectHome({ project }: { project: NoteMeta }) {
  const folder = project.project ?? "";
  const [folded, setFolded] = useFolded(folder);
  const settings = projectHome(project.props);
  if (!settings.shown || !folder) return null;
  const items = settings.sections.map((id) => ({
    id,
    wide: PROJECT_SECTIONS.find((d) => d.id === id)?.wide ?? false,
    node: <ProjectSection id={id} project={project} folder={folder} />,
  }));
  return (
    <section className="kasten-project-home" aria-label="Project home">
      <div className="kasten-dash-bar">
        <button type="button" className="kasten-dash-fold" aria-expanded={!folded} onClick={() => setFolded(!folded)}>
          <Icon name="chevron-down" className={`size-[14px] transition-transform ${folded ? "-rotate-90" : ""}`} />
          <Icon name="dashboard" className="size-[15px]" />
          Project home
        </button>
        <span className="flex-1" />
        <button type="button" className="ui-btn is-quiet is-sm" title="Open the project overview full size" onClick={(event) => openOverview(project, howFrom(event))}>
          <Icon name="expand" className="size-[14px]" />
          Expand
        </button>
        <Customize
          label="Project home"
          defs={PROJECT_SECTIONS}
          sections={settings.sections}
          defaults={PROJECT_DEFAULT}
          onChange={(sections) => void saveHome(project, { shown: true, sections })}
          extra={
            <button type="button" className="ui-btn is-quiet is-sm" onClick={() => void saveHome(project, { ...settings, shown: false })}>
              <Icon name="eye-off" className="size-[14px]" />
              Hide for this project
            </button>
          }
        />
      </div>
      {!folded && (items.length > 0 ? <DashGrid items={items} /> : <DashEmpty>No sections are on. Customize turns some on.</DashEmpty>)}
    </section>
  );
}
