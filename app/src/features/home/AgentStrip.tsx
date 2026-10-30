// One quiet line under Home's top line when agents changed something today:
// "Agents changed 23 things today · Review 2". "Review" goes to what waits for
// you; without anything waiting the line points at History instead. Nothing
// is drawn on a day with no agent changes, and not when the "Agents today"
// card is on (it says the same in more words).

import "./cards.css";

import { Icon } from "../../ui/Icon";
import { TODAY_BY_AGENTS } from "../review/today-by-agents";
import { useWorkspace } from "../workspace/store";
import { useAgentDigest } from "./agents-digest";
import { stripLine } from "./agents-today";

export function AgentStrip() {
  const { digest } = useAgentDigest();
  if (!digest || digest.changes === 0) return null;
  const go = useWorkspace.getState().go;
  return (
    <div className="kasten-agent-strip">
      <Icon name="agent" className="size-[14px] text-faint" />
      <span>{stripLine(digest)}</span>
      {digest.waiting > 0 ? (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" className="kasten-dash-link" onClick={() => go({ view: "review" })}>
            Review {digest.waiting}
          </button>
        </>
      ) : (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" className="kasten-dash-link" onClick={() => go({ view: "history", path: TODAY_BY_AGENTS })}>
            See what changed
          </button>
        </>
      )}
    </div>
  );
}
