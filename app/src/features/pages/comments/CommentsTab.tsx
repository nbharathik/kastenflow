// The right panel's Comments tab, for any page: the same stacks as the column
// beside a sections page, and a place to comment on the words selected in
// the page.

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

export function CommentsTab({ client, path, editor, ready, body }: Props) {
  const model = useComments({ client, path, editor, ready, body });
  const words = useSelectedWords(editor, ready, MOST_QUOTE);
  return (
    <section className="kasten-comments-tab" aria-label="Comments">
      <CommentsStacks model={model} editor={editor} words={words} />
    </section>
  );
}
