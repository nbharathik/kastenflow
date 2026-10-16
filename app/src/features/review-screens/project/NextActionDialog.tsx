// Pinning the task a project does next: its open task notes in a short list to
// filter and pick from, by the keyboard (arrows and Enter) or the pointer. The
// choice goes through the core's project op, and the notice offers Undo.

import { useId, useMemo, useState } from "react";

import { dayFrom } from "../../../lib/dates";
import { Button } from "../../../ui/Button";
import { Icon } from "../../../ui/Icon";
import { Modal } from "../../../ui/Modal";
import { dayWords } from "../assemble";
import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import { openTasksOf, setNextAction } from "./pieces";
import type { ProjectRef } from "./refs";

export function NextActionDialog({ project, onClose }: { project: ProjectRef; onClose(): void }) {
  const notes = useWorkspace((s) => s.notes);
  const id = useId();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const tasks = useMemo(() => openTasksOf(notes, project.folder), [notes, project.folder]);
  const words = text.trim().toLowerCase();
  const shown = tasks.filter((task) => !words || titleOf(task).toLowerCase().includes(words));
  const current = project.nextActionId ? notes.find((n) => n.id === project.nextActionId) : undefined;
  const today = dayFrom(0);
  const at = Math.min(active, Math.max(0, shown.length - 1));

  const choose = (task: (typeof tasks)[number] | null) => {
    onClose();
    void setNextAction(project, task);
  };

  return (
    <Modal label={`Next action for ${project.title}`} onClose={onClose} className="ui-dialog">
      <h2 className="ui-dialog-title">Next action for {project.title}</h2>
      <div className="ui-dialog-body">
        {current && (
          <p className="mb-2 text-13 text-muted">
            Now: <span className="text-ink">{titleOf(current)}</span>
          </p>
        )}
        {tasks.length === 0 ? (
          <p className="text-13 text-muted">This project has no open task. Make a page tagged #task in it, then pin it here.</p>
        ) : (
          <>
            <input
              autoFocus
              aria-label="Find a task"
              aria-controls={`${id}-list`}
              aria-activedescendant={shown.length > 0 ? `${id}-${at}` : undefined}
              placeholder="Find a task…"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") setActive(Math.min(at + 1, shown.length - 1));
                else if (event.key === "ArrowUp") setActive(Math.max(at - 1, 0));
                else if (event.key === "Enter" && shown[at]) choose(shown[at]!);
                else return;
                event.preventDefault();
              }}
              className="h-9 w-full rounded-md bg-well px-2.5 text-13 outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/60"
            />
            <div id={`${id}-list`} role="listbox" aria-label="Open tasks" className="mt-2 max-h-64 overflow-y-auto">
              {shown.length === 0 && <p className="px-2 py-2 text-13 text-muted">No task matches</p>}
              {shown.map((task, i) => {
                const due = typeof task.props.due === "string" ? task.props.due : null;
                return (
                  <button
                    key={task.path}
                    id={`${id}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === at}
                    tabIndex={-1}
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(task)}
                    className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-13 ${i === at ? "bg-hover" : ""}`}
                  >
                    <Icon name={task.id !== null && task.id === project.nextActionId ? "circle-check" : "todo"} className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{titleOf(task)}</span>
                    {due && <span className={`shrink-0 text-12 ${due < today ? "text-danger" : "text-muted"}`}>{dayWords(due, today)}</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      <footer className="ui-dialog-foot">
        {current && <Button onClick={() => choose(null)}>No next action</Button>}
        <Button onClick={onClose}>Cancel</Button>
      </footer>
    </Modal>
  );
}
