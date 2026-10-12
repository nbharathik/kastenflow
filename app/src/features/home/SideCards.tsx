// The slim column beside Home's list: the first open to-dos, with a field to
// add one, and what waits in the Inbox. Each is one calm block with a title
// row; "Tasks" and "Triage" go to the whole thing.

import { useMemo } from "react";

import { dayFrom } from "../../lib/dates";
import type { TaskRow } from "../../lib/vault/types";
import { DashCard } from "../dashboard/DashCard";
import { SeeAll } from "../dashboard/Minis";
import { NoteRow } from "../dashboard/NoteRow";
import { TodoList } from "../dashboard/TodoList";
import { useWorkspace } from "../workspace/store";
import { inboxCards } from "../workspace/tree";
import { ago } from "./when";

/** To-dos shown before "N more". */
const TODOS = 5;
/** Quick notes shown before "Triage". */
const CARDS = 3;

const notTemplates = (row: TaskRow) => !row.path.startsWith("templates/");
const goTasks = () => useWorkspace.getState().go({ view: "tasks" });

/** `withToday`: the Today card lists what is due today, so this one leaves it out. */
export function Todos({ withToday = false }: { withToday?: boolean }) {
  const find = useMemo(() => ({ key: "home:journal", find: () => useWorkspace.getState().ensureJournal() }), []);
  const today = dayFrom(0);
  const filter = useMemo(() => (withToday ? (row: TaskRow) => notTemplates(row) && row.due !== today : notTemplates), [withToday, today]);
  return (
    <DashCard title="To-dos" icon="tasks" actions={<SeeAll label="Tasks" run={goTasks} />}>
      <TodoList filter={filter} addTo={find} limit={TODOS} onMore={goTasks} empty="Nothing to do. A new to-do goes into today's journal." />
    </DashCard>
  );
}

export function Inbox() {
  const cards = useWorkspace((s) => inboxCards(s.notes));
  if (cards.length === 0) return null;
  return (
    <DashCard title="Inbox" icon="inbox" count={cards.length} actions={<SeeAll label="Triage" run={() => useWorkspace.getState().go({ view: "inbox" })} />}>
      <div className="kasten-dash-rows">
        {cards.slice(0, CARDS).map((card) => (
          <NoteRow key={card.path} note={card} detail={ago(card.modified)} />
        ))}
      </div>
    </DashCard>
  );
}
