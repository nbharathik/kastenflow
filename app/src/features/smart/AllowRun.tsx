import { Button } from "../../ui/Button";
import { ALLOW_NOTE, allowLine, UNKNOWN_MAKER_LINE, UNKNOWN_MAKER_NOTE } from "./words";

interface Props {
  /** The agent's client name. */
  madeBy: string;
  /** History is off, so nothing says who made the page. */
  unknownMaker?: boolean;
  onAllow(): void;
  busy?: boolean;
  /** One sentence when the choice could not be kept. */
  problem?: string | null;
  /** A block inside a page: one line and a button. */
  compact?: boolean;
}

/**
 * "Made by Claude Code · Allow to run": shown once for a smart page an agent
 * made, until a person allows it. Nothing of the page has run before then.
 */
export function AllowRun({ madeBy, unknownMaker = false, onAllow, busy = false, problem = null, compact = false }: Props) {
  return (
    <div className={`kasten-smart-allow${compact ? " is-compact" : ""}`} role="group" aria-label="This page has not run yet">
      <p className="kasten-smart-allow-line">
        <strong>{unknownMaker ? UNKNOWN_MAKER_LINE : allowLine(madeBy)}</strong>
        <span aria-hidden="true"> · </span>
        <Button tone="primary" size="sm" disabled={busy} onClick={onAllow}>
          Allow to run
        </Button>
      </p>
      {!compact && <p className="kasten-smart-allow-note">{unknownMaker ? `${ALLOW_NOTE} ${UNKNOWN_MAKER_NOTE}` : ALLOW_NOTE}</p>}
      {problem && (
        <p role="alert" className="kasten-smart-allow-problem">
          {problem}
        </p>
      )}
    </div>
  );
}
