// What a page's editor knows about tag databases, for `![[tags/x.yaml]]`
// embeds, /database and the database views: the databases
// to pick from, drawing one live inside the page, opening one, making a new
// one from a name, and finding (or adding) a view of a kind.

import { createRoot } from "react-dom/client";

import type { PropDef } from "../../../lib/vault/types";
import { schemaOf } from "../../panel/properties/schemas";
import { ViewBoundary } from "../../../ui/ViewBoundary";
import { EmbeddedDatabase } from "../../tags/EmbeddedDatabase";
import { newView, notesWith, projectFolderOf, scoped, viewsOf } from "../../tags/model";
import { tagPlace } from "../../tags/place";
import { useTags } from "../../tags/store";
import { tagFrom, type DatabaseLink, type LinkProvider } from "../../pages/editor/links";
import { useWorkspace } from "../store";

type DatabaseLinks = Required<Pick<LinkProvider, "databases" | "mountDatabase" | "openDatabase" | "createDatabase" | "viewOf">>;

/** What a new database starts with, so each kind of view has what it
 * needs: a status for the board, a date for the calendar. */
export const STARTER_PROPERTIES: PropDef[] = [
  { key: "status", type: "select", options: ["To do", "Doing", "Done"] },
  { key: "date", type: "date", options: [] },
];

/** `page` names the page the editor shows: a database's new notes become its sub-pages. */
export function databaseLinks(page: () => string | null = () => null): DatabaseLinks {
  return {
    databases: () => {
      const { schemas } = useTags.getState();
      if (schemas === null) void useTags.getState().load();
      const notes = useWorkspace.getState().notes;
      // In a project's page, a tag with a view of what is filed in a project (a capture's "This project") offers it too.
      const folder = projectFolderOf(page());
      return (schemas ?? []).map((schema): DatabaseLink => {
        const tagged = notesWith(notes, schema.name);
        const link: DatabaseLink = { tag: schema.name, path: schema.path, count: tagged.length };
        const here = folder === null ? undefined : viewsOf(schema).find((v) => v.scope === "project");
        if (here) link.inThisProject = { view: here.name, count: scoped(tagged, here, folder).length };
        return link;
      });
    },
    mountDatabase: (host, tag, view) => {
      const root = createRoot(host);
      root.render(
        <ViewBoundary place={`${tag}#${view}`}>
          <EmbeddedDatabase tag={tag} initial={view} page={page} />
        </ViewBoundary>,
      );
      return () => root.unmount();
    },
    openDatabase: (tag, how) => useWorkspace.getState().go(tagPlace(tag), how),
    createDatabase: async (name, kind) => {
      const tag = tagFrom(name);
      if (!tag) {
        useWorkspace.getState().toast(`“${name.trim()}” can’t name a database`);
        return null;
      }
      // Two changes through the core: the properties, then the view that uses them.
      if (!(await useTags.getState().saveProperties(tag, STARTER_PROPERTIES))) return null;
      const view = newView(kind, schemaOf(useTags.getState().schemas, tag) ?? null, []);
      await useTags.getState().saveViews(tag, [view]);
      const made = schemaOf(useTags.getState().schemas, tag);
      return made ? { path: made.path, view: view.name } : null;
    },
    viewOf: async (tag, kind) => {
      const schema = schemaOf(useTags.getState().schemas, tag) ?? null;
      const views = viewsOf(schema);
      const found = views.find((v) => v.type === kind);
      if (found) return found.name;
      const view = newView(kind, schema, views);
      await useTags.getState().saveViews(schema?.name ?? tag, [...views, view]);
      return viewsOf(schemaOf(useTags.getState().schemas, tag) ?? null).some((v) => v.name === view.name) ? view.name : null;
    },
  };
}
