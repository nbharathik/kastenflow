// A page's comments for the views that show them (the sections column and
// the panel's Comments tab): loaded from the vault, placed on the page's
// words again after every change to the page, and added, resolved and
// attached again through the vault's ops. The page's text is never touched.

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

import type { CommentAnchor, PageComment } from "../../../lib/vault/annotation-types";
import type { VaultClient } from "../../../lib/vault/types";
import { placeComment, type PageText } from "../../annotations/anchor";
import type { PageEditorHandle } from "../editor/page-handle";
import { useStamp } from "../../workspace/revision";
import { useWorkspace } from "../../workspace/store";
import type { PlacedComment } from "./comment-groups";

/** What the comments need of the open editor. */
export type CommentsEditor = Pick<PageEditorHandle, "annotationText" | "selectedWords" | "showWords" | "showSection" | "caretSection">;

/** The longest quote a comment keeps, in characters. */
export const MOST_QUOTE = 400;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface CommentsModel {
  /** Null until the comments are read. */
  placed: PlacedComment[] | null;
  /** The page's text the comments were placed in; null until the editor is there. */
  text: PageText | null;
  /** Why the comments could not be read, if they could not. */
  error: string | null;
  /** Adds a comment; false when it was refused (the reason is a toast). */
  add(text: string, anchor: CommentAnchor): Promise<boolean>;
  resolve(id: string, resolved: boolean): Promise<void>;
  /** Attaches a comment to another place. */
  attach(id: string, anchor: CommentAnchor): Promise<void>;
  /** Scrolls to a comment's words in the page; false when they are not there. */
  show(item: PlacedComment): boolean;
}

interface Options {
  client: VaultClient;
  /** The open page's path (its draft path while it has none). */
  path: string;
  editor: RefObject<CommentsEditor | null>;
  /** Counts the times the editor became ready. */
  ready: number;
  /** The page's body as the editor last reported it: new words move the comments. */
  body: string;
  /** Nothing is read while this is false. */
  enabled?: boolean;
}

export function useComments({ client, path, editor, ready, body, enabled = true }: Options): CommentsModel {
  const stamp = useStamp("annotations");
  const [comments, setComments] = useState<PageComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // Through a promise, so a client without the call is an error shown, not a crash.
    Promise.resolve()
      .then(() => client.comments(path))
      .then(
        (list) => {
          if (!live) return;
          setComments(list);
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

  // The editor is a ref, so the text is read again when it becomes ready and when the body changes.
  const text = useMemo(() => (enabled ? (editor.current?.annotationText() ?? null) : null), [editor, enabled, ready, body]);
  const placed = useMemo(() => (comments && text ? comments.map((comment) => ({ comment, place: placeComment(comment.anchor, text) })) : null), [comments, text]);

  const replace = useCallback((changed: PageComment) => setComments((was) => (was ? was.map((c) => (c.id === changed.id ? changed : c)) : was)), []);

  const add = useCallback(
    async (words: string, anchor: CommentAnchor) => {
      try {
        const added = await client.addComment(path, { anchor, text: words });
        setComments((was) => [...(was ?? []).filter((c) => c.id !== added.id), added]);
        return true;
      } catch (err) {
        useWorkspace.getState().toast(errorText(err));
        return false;
      }
    },
    [client, path],
  );

  const resolve = useCallback(
    async (id: string, resolved: boolean) => {
      try {
        replace(await client.resolveComment(path, id, resolved));
      } catch (err) {
        useWorkspace.getState().toast(errorText(err));
      }
    },
    [client, path, replace],
  );

  const attach = useCallback(
    async (id: string, anchor: CommentAnchor) => {
      try {
        replace(await client.reanchorComment(path, id, anchor));
      } catch (err) {
        useWorkspace.getState().toast(errorText(err));
      }
    },
    [client, path, replace],
  );

  const show = useCallback(
    (item: PlacedComment) => {
      const range = "range" in item.place ? item.place.range : null;
      const quote = item.comment.anchor.quote;
      return range && quote ? (editor.current?.showWords(range, quote) ?? false) : false;
    },
    [editor],
  );

  return { placed, text, error, add, resolve, attach, show };
}
