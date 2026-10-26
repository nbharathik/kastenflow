import "./smart.css";

import { Button } from "../../ui/Button";
import { Segmented } from "../../ui/Segmented";
import { setRunSwitch } from "./run-switch";
import type { SmartSide } from "./use-smart-side";
import { OFF_LINE } from "./words";
import type { SmartBackend } from "./backend";

const SIDES = [
  { value: "smart", label: "Smart" },
  { value: "notes", label: "Notes" },
  { value: "history", label: "History" },
] as const;

/** The switch in a smart page's header: its smart view, its notes (the Markdown page), the history of its code. */
export function SmartTabs({ side, onSide }: { side: SmartSide; onSide(side: SmartSide): void }) {
  return <Segmented<SmartSide> label="Smart page" value={side} choices={SIDES} onChange={onSide} className="kasten-smart-tabs" />;
}

/** Above a smart page's notes while smart pages are off: the page is its Markdown, and one button turns them back on. */
export function SmartOffLine({ backend }: { backend?: SmartBackend }) {
  return (
    <p className="kasten-smart-off" role="status">
      {OFF_LINE}
      <span aria-hidden="true"> — </span>
      <Button tone="quiet" size="sm" onClick={() => void (backend ? setRunSwitch(true, backend) : setRunSwitch(true))}>
        Turn on
      </Button>
    </p>
  );
}
