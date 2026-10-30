// The Summary section of a project's home: a line on what the project is
// (its `summary` property, edited in place), how far its to-dos are, and a
// way to ask the chat for a fuller summary. No counts: the sections below
// show what the project holds.

import { useMemo, useState } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { Button } from "../../ui/Button";
import { DashCard } from "../dashboard/DashCard";
import { useTaskList } from "../dashboard/task-rows";
import { askForSummary } from "./ask-summary";
import { saveSummary } from "./home-actions";
import { inFolder, todoCounts, type ProjectParts } from "./project-data";
import { ProjectStateMenu } from "./state/StateChips";

export function ProjectSummary({ project, parts }: { project: NoteMeta; parts: ProjectParts }) {
  const rows = useTaskList();
  const folder = project.project ?? "";
  const todos = useMemo(() => todoCounts((rows ?? []).filter(inFolder(folder))), [rows, folder]);
  const total = todos.open + todos.done;
  const done = total ? Math.round((todos.done / total) * 100) : 0;
  return (
    <DashCard
      title="Summary"
      icon="gauge"
      actions={
        <>
          <ProjectStateMenu project={project} />
          <Button size="sm" tone="quiet" icon="sparkle" onClick={() => void askForSummary(project, parts.recent)}>
            Ask AI
          </Button>
        </>
      }
    >
      <SummaryLine project={project} />
      {total > 0 && (
        <div className="kasten-dash-progress">
          <span className="kasten-dash-track" role="progressbar" aria-label="To-dos done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done}>
            <span style={{ transform: `scaleX(${done / 100})` }} />
          </span>
          <em>
            {todos.done} of {total} to-dos done
          </em>
        </div>
      )}
    </DashCard>
  );
}

/** The project's `summary` property as a line you can click to write. */
function SummaryLine({ project }: { project: NoteMeta }) {
  const saved = typeof project.props.summary === "string" ? project.props.summary : "";
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button type="button" className={`kasten-dash-summary${saved ? "" : " is-empty"}`} onClick={() => setDraft(saved)} title="Edit the summary">
        {saved || "Add a line on what this project is about…"}
      </button>
    );
  }
  const done = () => {
    if (draft.trim() !== saved.trim()) void saveSummary(project, draft);
    setDraft(null);
  };
  return (
    <input
      autoFocus
      className="kasten-dash-summary-field"
      aria-label="Project summary"
      value={draft}
      placeholder="What is this project about?"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") done();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}
