// One line per tool call in an answer: what the chat did, such as "Created
// card “Hotel ideas”", with links to the notes and boards it touched. A
// spinner while it works; red when the core refused; a link to Review when
// the change waits there.

import { memo, useState, type MouseEvent } from "react";

import { useBoards } from "../../boards/store";
import { howFrom, useWorkspace } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import type { Part } from "../thread";
import { describeCall, nameOf } from "../transcript";
import { useChatLinks } from "./links";
import { Icon } from "../../../ui/Icon";

const REVIEW = /waiting for review/i;
const PROPOSED = /pending[ _]review|proposal/i;

type ToolPart = Extract<Part, { kind: "tool" }>;

const summaryOf = ({ call, result }: ToolPart) => result?.summary.trim() || describeCall(call.name, call.input);

/** Whether a finished step waits for the person to review it. */
export const waitsForReview = (part: ToolPart): boolean => Boolean(part.result) && (REVIEW.test(summaryOf(part)) || PROPOSED.test(summaryOf(part)));

/** Whether a step must stay in sight when a long run is folded: one that failed, did not finish, is under way, or waits for review. */
export const needsEye = (part: ToolPart): boolean => !part.result || !part.result.ok || waitsForReview(part);

export const ToolRow = memo(function ToolRow({ part, live }: { part: ToolPart; live: boolean }) {
  const links = useChatLinks();
  const notes = useWorkspace((s) => s.notes);
  const boards = useBoards((s) => s.list);
  const { result } = part;
  // A row that appears while the answer streams enters; those of a finished answer opened from the list do not.
  const [enters] = useState(live);
  const state = result ? (result.ok ? "done" : "failed") : live ? "working" : "unfinished";
  const summary = summaryOf(part);
  const review = result ? REVIEW.exec(summary) : null;
  const toReview = () => links.go({ view: "review" });
  // Notes that are gone (trashed since, or undone) are not offered. A staged
  // change is not in the vault yet: what is there to open is the note as it was.
  const shown = result?.ok && !result.staged ? result.paths.filter((path) => (path.endsWith(".md") ? noteAt(notes, path) : true)) : [];
  const open = (path: string) => (event: MouseEvent) => links.openPath(path, howFrom(event));

  return (
    <div className={enters ? "kasten-chat-tool is-entering" : "kasten-chat-tool"} data-state={state} data-flip={part.call.id || undefined}>
      <span className="kasten-chat-tool-icon" aria-hidden="true">
        {state === "working" ? <span className="kasten-chat-spinner" /> : state === "done" ? <Icon name="check" className="size-3.5" /> : state === "failed" ? <Icon name="alert" className="size-3.5" /> : "–"}
      </span>
      <span className="kasten-chat-tool-text">
        {review ? (
          <>
            {summary.slice(0, review.index)}
            <button type="button" className="kasten-chat-tool-link" onClick={toReview}>
              {review[0]}
            </button>
            {summary.slice(review.index + review[0].length)}
          </>
        ) : (
          summary
        )}
        {state === "working" && "…"}
        {state === "unfinished" && <span className="kasten-chat-tool-note"> · did not finish</span>}
        {result?.staged && <span className="kasten-chat-tool-note"> · staged, not saved yet</span>}
      </span>
      {result && !review && PROPOSED.test(summary) && (
        <button type="button" className="kasten-chat-tool-link" onClick={toReview}>
          Waiting for review
        </button>
      )}
      {shown.map((path) => {
        const name = nameOf(path, { notes, boards });
        return (
          <button key={path} type="button" className="kasten-chat-tool-open" onClick={open(path)} aria-label={`Open ${name}`} title={`Open ${name}`}>
            {shown.length === 1 ? "Open" : name}
          </button>
        );
      })}
    </div>
  );
});
