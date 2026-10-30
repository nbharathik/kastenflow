// The health page (Settings → History and backup): how the vault stands, in
// sections, with what to look at under each. Looking changes nothing: it reads
// the health report and the lists the window already holds. "Check now" reads
// every file (the core's check); a repair is shown first, and done only when
// asked, by an operation the app already has.

import "./health.css";

import { useEffect, useMemo, useState } from "react";

import { useShell } from "../../lib/store";
import { Button } from "../../ui/Button";
import { useBrowserOn } from "../browser/prefs";
import { browserBackend } from "../browser/backend";
import { useDiagramEditor } from "../diagrams/editor";
import { useDiagrams } from "../diagrams/store";
import type { SaveState } from "../workspace/page/page-session";
import { useVaultStatus } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { sectionsOf, type Level, type Section } from "./health-sections";
import { useHealth } from "./health-store";
import { IssueRow } from "./IssueRow";

const DOT: Record<Level, string> = { ok: "bg-success", info: "bg-muted/60", warn: "bg-warning", fail: "bg-danger" };
const WORD: Record<Level, string> = { ok: "Fine", info: "For your information", warn: "Needs a look", fail: "Problem" };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function HealthCenter() {
  const client = useWorkspace((s) => s.client);
  const notes = useWorkspace((s) => s.notes);
  const health = useHealth((s) => s.health);
  const report = useHealth((s) => s.report);
  // Only whether a save failed (and which) and whether one is under way
  // count: not each page's save going from edited to saving to saved.
  const failed = useShell((s) => Object.keys(s.saveStates).find((path) => s.saveStates[path] === "failed"));
  const writing = useShell((s) => Object.values(s.saveStates).some((state) => state === "edited" || state === "saving"));
  const saves = useMemo<Record<string, SaveState>>(() => ({ ...(writing ? { "": "saving" as const } : {}), ...(failed !== undefined ? { [failed]: "failed" as const } : {}) }), [failed, writing]);
  const commitError = useVaultStatus((s) => s.error);
  const diagrams = useDiagrams((s) => s.list);
  const editor = useDiagramEditor((s) => s.info);
  const browserOn = useBrowserOn();
  const [checking, setChecking] = useState(false);

  // Reading only: the report, the diagrams' list and whether the editor is installed.
  useEffect(() => {
    if (!client) return;
    void useHealth.getState().refresh();
    if (!useDiagrams.getState().loaded) void useDiagrams.getState().load();
    if (!useDiagramEditor.getState().info) void useDiagramEditor.getState().refresh();
  }, [client]);

  const editorInstalled = editor ? editor.installed : null;
  const sections = useMemo(
    () => (health ? sectionsOf({ health, saves, commitError, report, diagrams, notes, editorInstalled, browser: { available: browserBackend().available, on: browserOn } }) : []),
    [health, saves, commitError, report, diagrams, notes, editorInstalled, browserOn],
  );

  if (!client) return null;
  const check = async () => {
    setChecking(true);
    try {
      await useHealth.getState().check();
    } catch (err) {
      useWorkspace.getState().toast(message(err));
    } finally {
      setChecking(false);
    }
  };
  const again = () => void useHealth.getState().refresh();

  return (
    <div className="kasten-health" aria-label="Vault health">
      <div className="kasten-health-bar">
        <p className="kasten-health-note">Looking here changes nothing. A fix is shown first and done only when you ask.</p>
        <Button size="sm" icon="refresh" onClick={again}>
          Refresh
        </Button>
        <Button size="sm" icon="check" disabled={checking} onClick={() => void check()}>
          {checking ? "Checking…" : "Check now"}
        </Button>
      </div>
      {health ? (
        sections.map((section) => <SectionView key={section.id} section={section} context={{ editorInstalled }} onRepaired={again} />)
      ) : (
        <p role="status" className="kasten-health-note">
          Reading the vault…
        </p>
      )}
    </div>
  );
}

function SectionView({ section, context, onRepaired }: { section: Section; context: { editorInstalled: boolean | null }; onRepaired(): void }) {
  return (
    <section className="kasten-health-section" aria-label={section.title} data-section={section.id} data-level={section.level}>
      <span aria-hidden="true" className={`kasten-health-dot ${DOT[section.level]}`} />
      <h4 className="kasten-health-title">
        {section.title}
        <span className="sr-only"> — {WORD[section.level]}</span>
      </h4>
      <p className="kasten-health-summary">{section.summary}</p>
      {section.issues.length > 0 && (
        <ul className="kasten-health-issues">
          {section.issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} level={section.level} context={context} onRepaired={onRepaired} />
          ))}
        </ul>
      )}
    </section>
  );
}
