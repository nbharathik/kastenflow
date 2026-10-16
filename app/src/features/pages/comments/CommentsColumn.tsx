// The comments beside a sections page: a column at its right edge with a
// stack for each section, found by the section's title and which of that
// title it is, so a comment stays with its section when sections move.

import "./comments.css";

import type { RefObject } from "react";

import type { VaultClient } from "../../../lib/vault/types";
import { useSelectedWords } from "../../annotations/use-selected-words";
import { CommentsStacks } from "./CommentsStacks";
import { MOST_QUOTE, useComments, type CommentsEditor } from "./use-comments";

interface Props {
  client: VaultClient;
  path: string;
  editor: RefObject<CommentsEditor | null>;
  ready: number;
  body: string;
}

export function CommentsColumn({ client, path, editor, ready, body }: Props) {
  const model = useComments({ client, path, editor, ready, body });
  const words = useSelectedWords(editor, ready, MOST_QUOTE);
  return (
    <aside className="kasten-comments-col" aria-label="Comments">
      <CommentsStacks model={model} editor={editor} words={words} />
    </aside>
  );
}
