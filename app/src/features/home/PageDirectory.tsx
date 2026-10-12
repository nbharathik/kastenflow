// Home's Pages section: every project's pages, sub-pages under their page,
// then the pages outside projects, each a click away. Cards stay in the
// Card Library.

import { useMemo, useState } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { DashCard } from "../dashboard/DashCard";
import { NoteRow } from "../dashboard/NoteRow";
import { iconOf, titleOf } from "../workspace/names";
import { useProjectLists } from "../workspace/project-actions";
import { howFrom, useWorkspace } from "../workspace/store";
import { childrenOf, loosePages, rowsUnder } from "../workspace/tree";
import "./directory.css";

/** Rows a group shows before "Show all". */
const SHOWN = 8;

interface Row {
  note: NoteMeta;
  depth: number;
}

interface Group {
  /** The project, or null for the pages outside projects. */
  project: NoteMeta | null;
  rows: Row[];
}

/** `tops` and their sub-pages below each, depth first; pages only. */
function flatten(notes: readonly NoteMeta[], tops: readonly NoteMeta[]): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  const walk = (list: readonly NoteMeta[], depth: number) => {
    for (const note of list) {
      if (note.kind !== "page" || seen.has(note.path)) continue;
      seen.add(note.path);
      out.push({ note, depth });
      walk(childrenOf(notes, note), depth + 1);
    }
  };
  walk(tops, 0);
  return out;
}

export function PageDirectory() {
  const notes = useWorkspace((s) => s.notes);
  const { active } = useProjectLists();
  const groups = useMemo<Group[]>(
    () => [...active.map((project) => ({ project, rows: flatten(notes, rowsUnder(notes, project)) })), { project: null, rows: flatten(notes, loosePages(notes)) }],
    [active, notes],
  );
  const total = groups.reduce((sum, g) => sum + g.rows.length, 0);
  if (total === 0 && active.length === 0) return null;
  return (
    <DashCard title="Pages" icon="page" count={total}>
      <div className="kasten-directory">
        {groups.map((group) =>
          group.project || group.rows.length > 0 ? <PageGroup key={group.project?.path ?? ""} group={group} /> : null,
        )}
      </div>
    </DashCard>
  );
}

function PageGroup({ group }: { group: Group }) {
  const [all, setAll] = useState(false);
  const { project, rows } = group;
  const title = project ? titleOf(project) : "Other pages";
  const shown = all ? rows : rows.slice(0, SHOWN);
  const create = () => useWorkspace.getState().newPage(project?.project ? { project: project.project } : {});
  return (
    <div role="group" aria-label={title} className="kasten-directory-group">
      <div className="kasten-directory-head">
        {project ? (
          <button type="button" className="kasten-directory-title" onClick={(e) => useWorkspace.getState().openPath(project.path, howFrom(e))}>
            <IconOrEmoji icon={iconOf(project)} />
            <span>{title}</span>
          </button>
        ) : (
          <span className="kasten-directory-title is-plain">{title}</span>
        )}
        <button type="button" className="kasten-directory-add" aria-label={`New page in ${title}`} title={`New page in ${title}`} onClick={create}>
          <Icon name="plus" className="size-3.5" />
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="kasten-directory-empty">No pages yet</p>
      ) : (
        <div className="kasten-dash-rows">
          {shown.map(({ note, depth }) => (
            <div key={note.path} className="flex flex-col" style={depth ? { paddingLeft: `${Math.min(depth, 3) * 16}px` } : undefined}>
              <NoteRow note={note} />
            </div>
          ))}
        </div>
      )}
      {rows.length > SHOWN && (
        <button type="button" className="kasten-directory-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
