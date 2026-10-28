import "./smart.css";

import { useEffect } from "react";

import { Button } from "../../ui/Button";
import { Segmented } from "../../ui/Segmented";
import { loadProjectSmart, projectOfPath, setProjectSmart, useProjectSmart } from "./availability";
import { setRunSwitch } from "./run-switch";
import type { SmartSide } from "./use-smart-side";
import { OFF_LINE, OFF_PROJECT_LINE } from "./words";
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

/**
 * Above a smart page's notes while smart pages are off for it: the page is its
 * Markdown, and one button turns them back on. When it is the page's project
 * that says off, the button turns them on for that project; otherwise it turns
 * the plugin on for the vault.
 */
export function SmartOffLine({ backend, page }: { backend?: SmartBackend; page?: string }) {
  const folder = page ? projectOfPath(page) : null;
  const projectSaysOff = useProjectSmart((s) => (folder ? s.projects[folder] === "off" : false));
  const known = useProjectSmart((s) => s.known);
  useEffect(() => {
    if (folder && !known) void (backend ? loadProjectSmart(backend) : loadProjectSmart());
  }, [folder, known, backend]);
  const turnOn = () => {
    if (projectSaysOff && folder) void (backend ? setProjectSmart(folder, "on", backend) : setProjectSmart(folder, "on"));
    else void (backend ? setRunSwitch(true, backend) : setRunSwitch(true));
  };
  return (
    <p className="kasten-smart-off" role="status">
      {projectSaysOff ? OFF_PROJECT_LINE : OFF_LINE}
      <span aria-hidden="true"> — </span>
      <Button tone="quiet" size="sm" onClick={turnOn}>
        Turn on
      </Button>
    </p>
  );
}
