// The highlights on a captured page: read from the vault, painted over the
// page's words, found again after every change by the exact rules (anchor.ts),
// and added, changed, moved and removed through the vault's ops. The page's
// text is never touched.

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

import type { TextAnchor, TextHighlight, TextHighlightEdit } from "../../lib/vault/annotation-types";
import type { VaultClient } from "../../lib/vault/types";
import type { PageEditorHandle } from "../pages/editor/page-handle";
import { useStamp } from "../workspace/revision";
import { useWorkspace } from "../workspace/store";
import { placeHighlight, sectionAtOffset, type PageText, type Range, type Words } from "./anchor";

/** What the highlights need of the open editor. */
export type HighlightEditor = Pick<PageEditorHandle, "annotationText" | "showWords" | "paint">;

/** The most characters of one highlight (the core keeps 5,000). */
export const MOST_HIGHLIGHT = 4_000;

export interface PlacedHighlight {
  highlight: TextHighlight;
  /** Where its words are on the page, or null when they are not found (detached). */
  range: Range | null;
}

export interface HighlightsModel {
  /** Null until read. */
  placed: PlacedHighlight[] | null;
  error: string | null;
  /** The one being looked at in the list: painted stronger. */
  current: string | null;
  setCurrent(id: string | null): void;
  /** Highlights words in a colour, with a comment if given; false when refused (the reason is a toast). */
  add(words: Words, color: string, comment?: string | null): Promise<boolean>;
  edit(id: string, edit: TextHighlightEdit): Promise<void>;
  remove(id: string): Promise<void>;
  /** Moves a highlight to other words. */
  attach(id: string, words: Words): Promise<void>;
  /** Scrolls to a highlight's words; false when they are not on the page. */
  show(item: PlacedHighlight): boolean;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const toast = (err: unknown) => useWorkspace.getState().toast(errorText(err));

/** A highlight's place for the words picked: the quote, what stands around it and, on a page with sections, the section it is in. */
function textAnchor(text: PageText | null, words: Words): TextAnchor {
  const section = text && text.sections.length > 1 ? text.sections[sectionAtOffset(text, words.from)]?.title : undefined;
  return { quote: words.quote, prefix: words.prefix, suffix: words.suffix, ...(section ? { section } : {}) };
}

interface Options {
  client: VaultClient;
  path: string;
  editor: RefObject<HighlightEditor | null>;
  ready: number;
  body: string;
  /** Nothing is read or painted while this is false (a page that was not kept from the web). */
  enabled: boolean;
}

export function useTextHighlights({ client, path, editor, ready, body, enabled }: Options): HighlightsModel {
  const stamp = useStamp("annotations");
  const [list, setList] = useState<TextHighlight[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // Through a promise, so a client without the call is an error shown, not a crash.
    Promise.resolve()
      .then(() => client.textHighlights(path))
      .then(
        (found) => {
          if (!live) return;
          setList(found);
          setError(null);
        },
        (err: unknown) => {
          if (live) setError(errorText(err));
        },
      );
    return () => {
      live = false;
    };
  }, [client, path, stamp, enabled]);

  // Painted over the words, again whenever the editor starts again.
  useEffect(() => {
    if (!enabled || !list) return;
    editor.current?.paint(list.map((h) => ({ id: h.id, color: h.color, anchor: h.anchor, current: h.id === current })));
  }, [enabled, list, current, ready, editor]);
  useEffect(
    () => () => {
      editor.current?.paint([]);
    },
    [editor, enabled],
  );

  const text = useMemo(() => (enabled ? (editor.current?.annotationText() ?? null) : null), [editor, enabled, ready, body]);
  const placed = useMemo(() => (list && text ? list.map((highlight) => ({ highlight, range: placeHighlight(highlight.anchor, text) })) : null), [list, text]);

  const replace = useCallback((changed: TextHighlight) => setList((was) => (was ? was.map((h) => (h.id === changed.id ? changed : h)) : was)), []);

  const add = useCallback(
    async (words: Words, color: string, comment?: string | null) => {
      try {
        const added = await client.addTextHighlight(path, { anchor: textAnchor(text, words), color, ...(comment?.trim() ? { comment: comment.trim() } : {}) });
        setList((was) => [...(was ?? []).filter((h) => h.id !== added.id), added]);
        return true;
      } catch (err) {
        toast(err);
        return false;
      }
    },
    [client, path, text],
  );

  const edit = useCallback(
    async (id: string, change: TextHighlightEdit) => {
      try {
        replace(await client.editTextHighlight(path, id, change));
      } catch (err) {
        toast(err);
      }
    },
    [client, path, replace],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await client.removeTextHighlight(path, id);
        setList((was) => (was ? was.filter((h) => h.id !== id) : was));
        setCurrent((was) => (was === id ? null : was));
      } catch (err) {
        toast(err);
      }
    },
    [client, path],
  );

  const attach = useCallback(
    async (id: string, words: Words) => {
      try {
        replace(await client.moveTextHighlight(path, id, textAnchor(text, words)));
      } catch (err) {
        toast(err);
      }
    },
    [client, path, replace, text],
  );

  const show = useCallback(
    (item: PlacedHighlight) => {
      setCurrent(item.highlight.id);
      return item.range ? (editor.current?.showWords(item.range, item.highlight.anchor.quote) ?? false) : false;
    },
    [editor],
  );

  return { placed, error, current, setCurrent, add, edit, remove, attach, show };
}
