// Opening a page at a spot: a link to one of its headings, or a search
// result, whose words the find bar then marks. The page takes the jump
// once its editor is ready, whether it opens now or is open already.

import { useEffect, type RefObject } from "react";
import { create } from "zustand";

import type { PageEditorHandle } from "../../pages/editor/PageEditor";
import { useWorkspace, type OpenHow } from "../store";

export interface Jump {
  path: string;
  /** A heading's text, to scroll to. */
  heading?: string;
  /** Which of several headings with that text, from 1; the first by default. */
  nth?: number;
  /** What was searched for: the first of these the page holds is marked. */
  find?: string[];
  /** When it was asked for; a jump left waiting goes stale. */
  at: number;
}

const STALE_MS = 10_000;

export const usePageJump = create<{ jump: Jump | null }>(() => ({ jump: null }));

/** Opens the page at `path` and goes to the heading, or marks the words. */
export function openAt(path: string, spot: { heading?: string; nth?: number; find?: string[] }, how?: OpenHow): void {
  usePageJump.setState({ jump: { path, ...spot, at: Date.now() } });
  useWorkspace.getState().openPath(path, how);
}

/** Takes a jump meant for the page at `path` once `editor` is ready;
 * `ready` changes each time a new editor is. */
export function usePageJumps(path: string, editor: RefObject<PageEditorHandle | null>, ready: number): void {
  const jump = usePageJump((s) => (s.jump?.path === path ? s.jump : null));
  useEffect(() => {
    const handle = editor.current;
    if (!jump || !handle) return;
    usePageJump.setState({ jump: null });
    if (Date.now() - jump.at > STALE_MS) return;
    if (jump.heading) handle.showHeading(jump.heading, jump.nth);
    else if (jump.find?.length) handle.find(jump.find);
  }, [jump, ready, editor]);
}

/** The words a search asked for, to mark in the page: the phrase, then
 * each word, longest first, leaving out filters such as `tag:travel`. */
export function searchedWords(query: string): string[] {
  const words = query
    .split(/\s+/)
    .map((w) => w.replace(/^["'(]+|["')*]+$/g, ""))
    .filter((w) => w && !/^-|^[a-z]+:/i.test(w) && !/^(AND|OR|NOT)$/.test(w));
  const phrase = words.join(" ");
  const single = [...new Set(words)].filter((w) => w.length > 1).sort((a, b) => b.length - a.length);
  return [...new Set([phrase, ...single])].filter(Boolean);
}
