// A proposal that went stale: the page changed after the agent read it. The
// core refuses to put the two together where they overlap (and never applies
// a change it cannot place); the chat's card says so and offers to ask the
// agent again, instead of showing a plain error or applying anything.

import { useEffect, useState } from "react";

import type { Proposal } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { useWorkspace } from "../../workspace/store";

/** The kinds of proposal that change the text of one page and carry its text before and after. */
const TEXT_OPS = new Set(["append", "replace_section", "edit"]);

/** Whether a proposal changes a page's text, so its hunks can be told apart and its page compared. */
export const isTextChange = (p: Proposal): p is Proposal & { before: string; after: string; target: { path: string; title: string } } =>
  TEXT_OPS.has(p.op.kind) && p.before !== null && p.after !== null && Boolean(p.target?.path.endsWith(".md"));

/** Whether a refusal from the core says the page moved on since the agent read it. */
export const isStaleReason = (reason: string): boolean => /\bchanged\b[^.]*\bsince\b/i.test(reason) || /same lines/i.test(reason);

/** Whether the page the proposal is about no longer has the text the agent read. Read when the card shows and
 * when the window is back in front; `refused` is the core's last refusal. */
export function useStale(p: Proposal, refused?: string): boolean {
  const client = useWorkspace((s) => s.client);
  const [differs, setDiffers] = useState(false);
  const [look, setLook] = useState(0);
  useEffect(() => {
    const again = () => setLook((n) => n + 1);
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, []);
  const path = isTextChange(p) ? p.target.path : null;
  const before = p.before;
  useEffect(() => {
    if (!client || !path) return;
    let live = true;
    client.read(path).then(
      (note) => live && setDiffers(splitFrontmatter(note.text).body !== before),
      // A page that cannot be read says nothing about it; the core decides when asked.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client, path, before, look, p.id]);
  return differs || (refused !== undefined && isStaleReason(refused));
}
