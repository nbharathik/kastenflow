// A tag database inside a page: the Tag Database in small.
// Its views as tabs, with "+ View" to add a table, board, list, gallery or
// calendar; the view's filters and sorts; Properties, to add the details
// notes carry; and New. Switching tabs is this page's view of it; views,
// properties and notes are the tag's, the same as in the Tag Database.

import "./tags.css";

import { useEffect, useMemo, useState } from "react";

import type { TagView } from "../../lib/vault/types";
import { schemaOf } from "../panel/properties/schemas";
import { useWorkspace } from "../workspace/store";
import { NoteHomeContext } from "./home";
import { applyView, notesWith, projectFolderOf, scoped, viewsOf } from "./model";
import { SchemaEditor } from "./SchemaEditor";
import { useTags } from "./store";
import { NewNote, ViewBody } from "./TagDatabase";
import { ViewBar } from "./ViewBar";
import { ViewTabs } from "./ViewTabs";

const NO_PAGE = () => null;

/** `page` says which page it sits in now (a rename or a move changes the
 * path): notes made here become its sub-pages. */
export function EmbeddedDatabase({
  tag,
  initial,
  page = NO_PAGE,
}: {
  tag: string;
  initial: string;
  page?: () => string | null;
}) {
  const schemas = useTags((s) => s.schemas);
  const notes = useWorkspace((s) => s.notes);
  useEffect(() => {
    if (useTags.getState().schemas === null) void useTags.getState().load();
  }, []);
  const schema = schemaOf(schemas, tag) ?? null;
  const name = schema?.name ?? tag;
  const views = useMemo(() => viewsOf(schema), [schema]);
  const [active, setActive] = useState(initial);
  const index = Math.max(
    0,
    views.findIndex((v) => v.name.toLowerCase() === active.toLowerCase()),
  );
  const view = views[index]!;
  // Read on every draw; a rename or a move changes the notes, which draws.
  const parent = page();
  // A view saved with `scope: project` (a tag's "This project") shows only what is
  // filed in the project this page is in, and nothing in a page with none.
  const folder = projectFolderOf(parent);
  const tagged = useMemo(
    () => scoped(notesWith(notes, name), view, folder),
    [notes, name, view, folder],
  );
  const shown = useMemo(
    () => applyView(tagged, view, schema),
    [tagged, view, schema],
  );
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const home = useMemo(() => ({ project: null, parent }), [parent]);
  const saveViews = (next: TagView[]) =>
    void useTags.getState().saveViews(name, next);
  const change = (next: TagView) => {
    saveViews(views.map((v, i) => (i === index ? next : v)));
    if (next.name !== view.name) setActive(next.name);
  };
  if (schemas === null)
    return <p className="kasten-tag-empty">Opening #{tag}…</p>;
  return (
    <NoteHomeContext.Provider value={home}>
      <div className="kasten-db-embed-inner">
        <ViewTabs
          views={views}
          active={index}
          schema={schema}
          onSelect={(i) => setActive(views[i]!.name)}
          onSave={(next, selected) => {
            saveViews(next);
            if (selected) setActive(selected);
          }}
        />
        <div className="kasten-db-embed-bar">
          <ViewBar
            view={view}
            schema={schema}
            shown={shown.length}
            total={tagged.length}
            onChange={change}
          />
          <button
            type="button"
            className="kasten-tagdb-button"
            onClick={() => setEditing(true)}
          >
            Properties
            {schema?.properties.length ? ` · ${schema.properties.length}` : ""}
          </button>
          <button
            type="button"
            className="kasten-tagdb-button is-primary"
            onClick={() => setAdding(true)}
          >
            New
          </button>
        </div>
        {adding && <NewNote tag={name} onDone={() => setAdding(false)} />}
        <ViewBody
          tag={name}
          schema={schema}
          view={view}
          notes={shown}
          onChange={change}
        />
        {editing && (
          <SchemaEditor
            tag={name}
            schema={schema}
            onClose={() => setEditing(false)}
          />
        )}
      </div>
    </NoteHomeContext.Provider>
  );
}
