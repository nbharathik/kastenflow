// What to do with one inbox card: tag it or put it on a board, each from a
// small searchable picker (shared with the Card Library's bulk bar).

import { useEffect, useRef, useState } from "react";

import type { BoardInfo } from "../../lib/vault/types";
import { cleanTag } from "../library/bulk";
import { Picker } from "../library/Picker";
import { useWorkspace } from "../workspace/store";
import { tagCounts } from "../workspace/tree";
import { lineIcon } from "../../ui/glyph";
import { Icon } from "../../ui/Icon";

const button = "ui-btn";

/** A small icon button, for a row's hover tools (the Inbox list). */
export const TOOL = "ui-icon-btn is-sm";

interface ActionProps {
  path: string;
  open: boolean;
  onOpen(): void;
  onClose(): void;
  /** The key that opens it, shown on the button. */
  hint?: string;
  /** An icon alone, named by its tooltip: for a row's hover tools. */
  compact?: boolean;
}

/** The button that opens an action's picker: labelled, or an icon alone. */
function Opener({ label, icon, open, hint, compact, onClick }: { label: string; icon: "tag" | "board"; open: boolean; hint?: string; compact?: boolean; onClick(): void }) {
  if (compact) {
    return (
      <button type="button" className={TOOL} aria-label={label} title={label === "Tag" ? "Add a tag" : "Put on a board"} aria-expanded={open} onClick={onClick}>
        <Icon name={icon} className="size-4" />
      </button>
    );
  }
  return (
    <button type="button" className={button} aria-expanded={open} onClick={onClick}>
      {hint && <kbd className="rounded bg-line/70 px-1.5 font-sans text-11">{hint}</kbd>}
      {label}
    </button>
  );
}

/** Tags one card, with Undo in the notice to take the tag off again. */
export async function tagCard(path: string, tag: string): Promise<void> {
  const { client, noteChanged, toast } = useWorkspace.getState();
  if (!client) return;
  const change = async (add: string[], remove: string[]) => noteChanged((await client.setTags(path, add, remove)).meta);
  try {
    await change([tag], []);
    toast(`Tagged #${tag}`, { label: "Undo", run: () => void change([], [tag]).catch((err: unknown) => toast(err instanceof Error ? err.message : String(err))) });
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
}

/** Adds a tag, existing or new. */
export function TagAction({ path, open, onOpen, onClose, hint, compact }: ActionProps) {
  const notes = useWorkspace((s) => s.notes);
  const within = useRef<HTMLSpanElement>(null);
  const add = async (tag: string) => {
    onClose();
    await tagCard(path, tag);
  };
  return (
    <span ref={within} className="relative">
      <Opener label="Tag" icon="tag" open={open} hint={hint} compact={compact} onClick={open ? onClose : onOpen} />
      {open && (
        <Picker
          label="Add tag"
          placeholder="Find or type a tag…"
          options={tagCounts(notes).map((t) => ({ key: t.tag, label: `#${t.tag}`, detail: String(t.count) }))}
          onPick={(tag) => void add(tag)}
          create={{
            label: (text) => (cleanTag(text) ? `New tag #${cleanTag(text)}` : null),
            prompt: "Type the new tag's name",
            run: (text) => {
              const tag = cleanTag(text);
              if (tag) void add(tag);
            },
          }}
          within={within}
          onClose={onClose}
        />
      )}
    </span>
  );
}

/** Puts the card on a board, existing or new. */
export function BoardAction({ path, open, onOpen, onClose, hint, compact }: ActionProps) {
  const client = useWorkspace((s) => s.client);
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const within = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open || !client) return;
    setBoards(null);
    client.boards().then(setBoards, () => setBoards([]));
  }, [open, client]);

  const put = async (board: string, title: string) => {
    onClose();
    const { toast } = useWorkspace.getState();
    if (!client) return;
    try {
      const added = await client.addToBoard(board, [path], "grid");
      if (!added.created.length) return toast(`Already on “${title}”`);
      // Undo takes the new card off the board again; the note stays.
      toast(`Added to “${title}”`, {
        label: "Undo",
        run: () => void client.boardApply(board, [{ kind: "remove", ids: added.created }]).then(() => toast(`Took it off “${title}”`), (err: unknown) => toast(err instanceof Error ? err.message : String(err))),
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <span ref={within} className="relative">
      <Opener label="Board" icon="board" open={open} hint={hint} compact={compact} onClick={open ? onClose : onOpen} />
      {open && (
        <Picker
          label="Add to board"
          placeholder="Find a board…"
          options={boards?.map((b) => ({ key: b.path, label: b.title, icon: lineIcon("board"), detail: String(b.nodes) })) ?? null}
          empty="No boards yet"
          onPick={(board) => void put(board, boards?.find((b) => b.path === board)?.title ?? board)}
          create={{
            label: (text) => (text.trim() ? `New board “${text.trim()}”` : "New board…"),
            prompt: "Name the new board",
            run: (text) => {
              const title = text.trim();
              if (!title || !client) return;
              void client.createBoard(title, null).then(
                (board) => put(board, title),
                (err: unknown) => useWorkspace.getState().toast(err instanceof Error ? err.message : String(err)),
              );
            },
          }}
          within={within}
          onClose={onClose}
        />
      )}
    </span>
  );
}
