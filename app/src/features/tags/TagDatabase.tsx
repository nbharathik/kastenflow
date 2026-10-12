// A tag's database: the notes
// carrying it, through the tag's saved views (table, board, list or
// calendar or gallery) with each view's filters and sorts, all kept in the
// tag's YAML.

import "./tags.css";

import { useEffect, useMemo, useState } from "react";

import type { TagView } from "../../lib/vault/types";
import { CalendarView } from "../calendar/CalendarView";
import { chipStyle, schemaOf, swatch } from "../panel/properties/schemas";
import { useWorkspace } from "../workspace/store";
import { addNote } from "./actions";
import { useNoteHome } from "./home";
import { applyView, findInView, notesWith, viewsOf } from "./model";
import { SchemaEditor } from "./SchemaEditor";
import { useTags } from "./store";
import { ViewBar } from "./ViewBar";
import { ViewTabs } from "./ViewTabs";
import { GalleryView } from "./views/GalleryView";
import { KanbanView } from "./views/KanbanView";
import { ListView } from "./views/ListView";
import { TableView } from "./views/TableView";
import type { ViewProps } from "./views/types";

const ACTIVE = (tag: string) => `kasten.tagview.${tag.toLowerCase()}`;

function loadActive(tag: string): string | null {
  try {
    return localStorage.getItem(ACTIVE(tag));
  } catch {
    return null;
  }
}

function saveActive(tag: string, name: string): void {
  try {
    localStorage.setItem(ACTIVE(tag), name);
  } catch {
    // The first view shows next time.
  }
}

export function ViewBody(props: ViewProps) {
  switch (props.view.type) {
    case "kanban":
      return <KanbanView {...props} />;
    case "list":
      return <ListView {...props} />;
    case "gallery":
      return <GalleryView {...props} />;
    case "calendar":
      return <CalendarView scope={{ tag: props.tag, date: props.view.date, notes: props.notes }} />;
    default:
      return <TableView {...props} />;
  }
}

export function TagDatabase({ tag }: { tag: string }) {
  const schemas = useTags((s) => s.schemas);
  const notes = useWorkspace((s) => s.notes);
  useEffect(() => {
    void useTags.getState().load();
  }, []);

  const schema = schemaOf(schemas, tag) ?? null;
  const name = schema?.name ?? tag;
  const views = useMemo(() => viewsOf(schema), [schema]);
  const [active, setActive] = useState(() => loadActive(name));
  const index = Math.max(0, views.findIndex((v) => v.name === active));
  const view = views[index]!;
  const tagged = useMemo(() => notesWith(notes, name), [notes, name]);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => findInView(applyView(tagged, view, schema), query), [tagged, view, schema, query]);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const saveViews = (next: TagView[]) => void useTags.getState().saveViews(name, next);
  const change = (next: TagView) => {
    saveViews(views.map((v, i) => (i === index ? next : v)));
    if (next.name !== view.name) select(next.name);
  };
  const select = (viewName: string) => {
    setActive(viewName);
    saveActive(name, viewName);
  };
  const tone = swatch(schema?.color);

  return (
    <div className="kasten-tagdb">
      <header className="kasten-tagdb-head">
        <h1>
          <span className="kasten-tagdb-chip" style={chipStyle(tone)}>
            #{name}
          </span>
        </h1>
        <span className="text-13 text-muted">
          {tagged.length.toLocaleString()} {tagged.length === 1 ? "note" : "notes"}
        </span>
        <span className="flex-1" />
        <button type="button" className="kasten-tagdb-button" onClick={() => setEditing(true)}>
          Properties{schema?.properties.length ? ` · ${schema.properties.length}` : ""}
        </button>
        <button type="button" className="kasten-tagdb-button is-primary" onClick={() => setAdding(true)}>
          New
        </button>
      </header>
      {adding && <NewNote tag={name} onDone={() => setAdding(false)} />}
      <ViewTabs
        views={views}
        active={index}
        schema={schema}
        onSelect={(i) => select(views[i]!.name)}
        onSave={(next, selected) => {
          saveViews(next);
          if (selected) select(selected);
        }}
      />
      <ViewBar view={view} schema={schema} shown={shown.length} total={tagged.length} onChange={change} find={{ query, onQuery: setQuery }} />
      <div className="kasten-tagdb-body">
        {view.scope === "project" ? (
          // Such a view shows what is filed in the project of the page it sits in.
          <p className="kasten-tag-empty">This view lists the notes filed in one project. In a project&rsquo;s page, type /database and pick it from the list.</p>
        ) : (
          <ViewBody tag={name} schema={schema} view={view} notes={shown} onChange={change} />
        )}
      </div>
      {editing && <SchemaEditor tag={name} schema={schema} onClose={() => setEditing(false)} />}
    </div>
  );
}

/** A title field for a new note carrying the tag. */
export function NewNote({ tag, onDone }: { tag: string; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const home = useNoteHome();
  const submit = async () => {
    if (title.trim()) await addNote(tag, title, {}, home);
    onDone();
  };
  return (
    <form
      className="kasten-tagdb-new"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        autoFocus
        aria-label={`New note in #${tag}`}
        placeholder={`New note in #${tag}…`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        onBlur={() => !title.trim() && onDone()}
      />
      <button type="submit" disabled={!title.trim()}>
        Add
      </button>
    </form>
  );
}
