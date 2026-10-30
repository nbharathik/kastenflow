// Tasks: every to-do in the vault, as a list to filter and group,
// or as a board of #task notes by status. Ticking writes the page through
// the core; the filters are remembered in this window.

import "../dashboard/dashboard.css";

import { useMemo, useState } from "react";

import { useToday } from "../../lib/use-today";
import { Segmented } from "../../ui/Segmented";
import { projectTitle } from "../boards/store";
import { useTaskList } from "../dashboard/task-rows";
import { titleOf } from "../workspace/names";
import { useWorkspace } from "../workspace/store";
import { projects } from "../workspace/tree";
import { ALL_TASKS, filterTasks, groupTasks, placesOf, type DueFilter, type Grouping, type TaskFilter } from "./filters";
import { TaskBoard } from "./TaskBoard";
import { TaskGroups } from "./TaskGroups";
import { Icon } from "../../ui/Icon";
import { AddTodo, type AddTarget } from "../dashboard/TodoList";

type Mode = "list" | "board";
interface Saved {
  mode: Mode;
  by: Grouping;
  filter: TaskFilter;
}

const KEY = "kasten.tasks.view";

function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Saved>;
    return { mode: saved.mode === "board" ? "board" : "list", by: saved.by ?? "page", filter: { ...ALL_TASKS, ...saved.filter, text: "" } };
  } catch {
    return { mode: "list", by: "page", filter: ALL_TASKS };
  }
}

const DUE: { value: DueFilter; label: string }[] = [
  { value: "any", label: "Any day" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "week", label: "Next 7 days" },
  { value: "none", label: "No day" },
];

export function Tasks() {
  const [saved, setSaved] = useState(load);
  const { mode, by } = saved;
  const change = (patch: Partial<Saved>) =>
    setSaved((s) => {
      const next = { ...s, ...patch, filter: { ...s.filter, ...patch.filter } };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // The usual filters next time.
      }
      return next;
    });
  const rows = useTaskList();
  const notes = useWorkspace((s) => s.notes);
  const today = useToday();
  const places = useMemo(() => placesOf(projects(notes).filter((p) => p.project).map((p) => ({ folder: p.project!, title: titleOf(p) }))), [notes]);
  // A place saved and since gone (a project deleted or renamed) shows
  // everything, as its menu does; the saved choice comes back with it.
  const known = places.some((p) => p.value === saved.filter.where);
  const filter = useMemo(() => (known ? saved.filter : { ...saved.filter, where: "all" }), [known, saved.filter]);
  const shown = useMemo(() => filterTasks(rows ?? [], filter, today), [rows, filter, today]);
  const groups = useMemo(() => groupTasks(shown, by, today, (folder) => projectTitle(notes, folder)), [shown, by, today, notes]);
  // A to-do added here goes to the project chosen, else today's journal.
  const project = projects(notes).find((p) => p.project && `project:${p.project}` === filter.where);
  const addTo = useMemo<AddTarget>(() => (project ? project.path : { key: "tasks:journal", find: () => useWorkspace.getState().ensureJournal() }), [project]);
  const open = (rows ?? []).filter((r) => !r.done).length;
  const late = (rows ?? []).filter((r) => !r.done && r.due && r.due < today).length;

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 pb-24 pt-10 sm:px-12">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-28 font-bold tracking-tight">
            <Icon name="tasks" className="mr-2.5 inline size-[26px] align-[-4px] text-muted" />
            Tasks
          </h1>
          <p className="mt-1 text-14 text-muted">
            {rows ? `${open} open ${open === 1 ? "to-do" : "to-dos"}` : "Gathering to-dos…"}
            {late > 0 && <span className="text-danger"> · {late} overdue</span>}
          </p>
        </div>
        <Segmented label="Show tasks as" value={mode} onChange={(m) => change({ mode: m })} choices={[{ value: "list", label: "To-dos", icon: "tasks" }, { value: "board", label: "Board", icon: "kanban" }]} />
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-13" role="toolbar" aria-label="Filters">
        <input
          type="search"
          value={filter.text}
          onChange={(e) => change({ filter: { ...filter, text: e.target.value } })}
          placeholder="Find a to-do…"
          aria-label="Find a to-do"
          className="h-7 w-48 rounded-[4px] bg-well px-2 outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/60"
        />
        <select aria-label="Where" value={filter.where} onChange={(e) => change({ filter: { ...filter, where: e.target.value } })} className="h-7 rounded-[4px] bg-well px-1.5">
          {(mode === "board" ? places.filter((p) => p.value !== "journal") : places).map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {mode === "list" && (
          <>
            <Segmented label="Status" value={filter.status} onChange={(status) => change({ filter: { ...filter, status } })} choices={[{ value: "open", label: "Open" }, { value: "done", label: "Done" }, { value: "all", label: "All" }]} />
            <select aria-label="Day" value={filter.due} onChange={(e) => change({ filter: { ...filter, due: e.target.value as DueFilter } })} className="h-7 rounded-[4px] bg-well px-1.5">
              {DUE.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            <span className="flex-1" />
            <Segmented label="Group by" value={by} onChange={(g) => change({ by: g })} choices={[{ value: "page", label: "Page" }, { value: "day", label: "Day" }, { value: "project", label: "Project" }]} />
          </>
        )}
      </div>

      {mode === "list" && (
        <div className="kasten-todos mt-5">
          <AddTodo target={addTo} />
        </div>
      )}

      {mode === "list" ? (
        <TaskGroups rows={rows} groups={groups} by={by} today={today} filtered={filter.text !== "" || filter.due !== "any" || filter.where !== "all" || filter.status !== "open"} />
      ) : (
        <div className="mt-6">
          <TaskBoard where={filter.where === "journal" ? "all" : filter.where} text={filter.text} />
        </div>
      )}
    </div>
  );
}
