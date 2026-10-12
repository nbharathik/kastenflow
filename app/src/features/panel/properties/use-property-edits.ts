// Editing a note's tags and properties, shared by the right panel's
// Properties and the properties under a page's title.

import { useReducer, useRef } from "react";

import type { NoteMeta, TagSchema } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";
import { namedByPath } from "../links/related";
import { editFrontmatter, type PanelPage } from "../page-edit";
import { schemaOf, useSchemas } from "./schemas";
import { cleanTag } from "./TagEditor";
import { propOf } from "./values";

interface Pending<T> {
  value: T;
  /** Which edit this is, so an older one finishing does not clear a newer one. */
  token: object;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The note's props with edits on their way applied (null removes a key). */
function withPending(props: Record<string, unknown>, pending: Map<string, Pending<unknown>>): Record<string, unknown> {
  if (pending.size === 0) return props;
  const out = { ...props };
  for (const [key, { value }] of pending) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

/** Tags after adding and removing, ignoring case as the core does. */
function adjustTags(tags: string[], add: string[], remove: string[]): string[] {
  const gone = remove.map((t) => cleanTag(t).toLowerCase());
  const out = tags.filter((t) => !gone.includes(t.toLowerCase()));
  for (const tag of add.map(cleanTag)) if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  return out;
}

/**
 * Properties Kasten keeps for a page's own views: a project's home sections and its saved overview tables.
 * They are changed in those views (Customize, the overview's tables), so the property list does not offer
 * them as text; they stay in the file as they are.
 */
export const VIEW_KEYS: ReadonlySet<string> = new Set(["home", "overview"]);

/** A note's tags and properties with edits on their way applied, and how
 * to change them: each edit sends just its key and shows at once, and
 * rolls back when the core refuses it. */
export function usePropertyEdits(note: NoteMeta, page: PanelPage) {
  const schemas = useSchemas(page.client, note.path);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Edits on their way, kept in refs so a second edit sees the first at once.
  const pendingProps = useRef(new Map<string, Pending<unknown>>());
  const pendingTags = useRef<Pending<string[]> | null>(null);

  const props = withPending(note.props, pendingProps.current);
  const tags = pendingTags.current?.value ?? note.tags;
  const groups = tags.map((tag) => ({ tag, schema: schemaOf(schemas, tag) })).filter((g): g is { tag: string; schema: TagSchema } => g.schema !== undefined);
  const schemaKeys = new Set(groups.flatMap((g) => g.schema.properties.map((p) => p.key)));
  const otherKeys = Object.keys(props).filter((key) => !schemaKeys.has(key) && !VIEW_KEYS.has(key));

  const saveProp = async (key: string, value: unknown) => {
    const waiting = pendingProps.current.get(key);
    if (waiting ? sameValue(waiting.value, value) : sameValue(propOf(note.props, key) ?? null, value)) return;
    const token = {};
    pendingProps.current.set(key, { value, token });
    rerender();
    const saved = await editFrontmatter(page, () => page.client.updateProps(note.path, { [key]: value }));
    const named = saved ? namedByPath(value) : [];
    if (named.length > 0) await useWorkspace.getState().filesChanged(named);
    if (pendingProps.current.get(key)?.token === token) pendingProps.current.delete(key);
    rerender();
  };

  const changeTags = async (add: string[], remove: string[]) => {
    const next = adjustTags(tags, add, remove);
    if (sameValue(next, tags)) return;
    const token = {};
    pendingTags.current = { value: next, token };
    rerender();
    await editFrontmatter(page, () => page.client.setTags(note.path, add, remove));
    if (pendingTags.current?.token === token) pendingTags.current = null;
    rerender();
  };

  return { schemas, tags, props, groups, otherKeys, saveProp, changeTags };
}
