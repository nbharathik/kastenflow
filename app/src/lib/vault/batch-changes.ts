// The changes a batch is made of, as the window writes them. Each is kasten-core's
// agent op as JSON; the core checks every one again and refuses the whole batch
// if any is refused.

import type { BatchChange, BatchRef } from "./batch-types";
import type { PropDef, TagView } from "./tag-types";

/** A reference to the note change `index` makes. */
export const ref = (index: number): BatchRef => ({ $ref: index });

export interface NewPage {
  title: string;
  tags?: string[];
  props?: Record<string, unknown>;
  /** A page's path (or a reference to a note an earlier change makes): the new page is its sub-page. */
  parent?: string | BatchRef;
  /** A project's folder name. */
  project?: string | null;
}

/** A new page, with its tags and properties. */
export function createPage(page: NewPage): BatchChange {
  return {
    kind: "create_note",
    type: "page",
    title: page.title,
    tags: page.tags ?? [],
    props: page.props ?? {},
    ...(page.parent === undefined ? {} : { parent: page.parent }),
    ...(page.project ? { project: page.project } : {}),
  };
}

/** The schema of a tag that has none yet (the batch is refused if it has one): its properties and views. */
export function newTagSchema(tag: string, properties: PropDef[], views: TagView[]): BatchChange {
  return {
    kind: "tag_schema",
    tag,
    schema: {
      properties: properties.map((p) => ({ key: p.key, type: p.type, ...(p.options.length ? { options: p.options } : {}) })),
      views,
    },
  };
}

/** One block of a page written again; `block` and `hash` are those `pageBlocks` read. */
export function replaceBlock(path: string, block: { id: string; hash: string }, markdown: string): BatchChange {
  return { kind: "edit_page", path, steps: [{ op: "replace", block: { block: block.id, hash: block.hash }, markdown }] };
}

/** The order a table view shows its rows in: note ids first to last (none takes it away). */
export function viewOrder(tag: string, view: string, ids: string[]): BatchChange {
  return { kind: "set_view_order", tag, view, ids };
}
