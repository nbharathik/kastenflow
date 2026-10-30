// Settings → AI agents → How much agents may do: three cards (Review everything,
// Balanced, Autonomous) with one plain sentence each, a time box for Autonomous,
// and a mode of its own for any project. Only a person changes it; the core
// keeps it in the vault's settings and says what holds.

import "./agent-mode.css";

import { useEffect, useId, useState } from "react";

import { AGENT_MODES, type AgentMode, type ProjectSummary } from "../../../../lib/vault/types";
import { Button } from "../../../../ui/Button";
import { boxOf, MODE_NAMES, MODE_SENTENCES, TIME_BOXES, untilWords } from "../../../agents/policy";
import { useAgentMode } from "../../../agents/store";
import { useWorkspace } from "../../store";
import { Block, Extra, Group, Note, Row, Segmented } from "./parts";

const CARD = "How much agents may do";
const INHERIT = "inherit";

export function AgentModeSettings() {
  const client = useWorkspace((s) => s.client);
  const view = useAgentMode((s) => s.view);
  const error = useAgentMode((s) => s.error);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    void useAgentMode.getState().load();
    let live = true;
    client?.projectSummaries().then(
      (found) => live && setProjects(found.filter((p) => !p.archived)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [client]);

  const mode = view?.mode ?? "balanced";
  const pick = (next: AgentMode) => void useAgentMode.getState().setMode(next);
  const name = useId();

  return (
    <Group title={CARD} sub help="Review everything holds every change for you. Balanced lets small changes through. Autonomous lets agents work freely for a while; everything they do can be undone, and a restore point is saved first.">
      <Block id="agents.mode" titled>
        <div role="radiogroup" aria-label={CARD} className="kasten-mode-cards">
          {AGENT_MODES.map((option) => (
            <label key={option} className="kasten-mode-card" data-checked={mode === option}>
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={mode === option}
                disabled={!view}
                aria-labelledby={`${name}-${option}-name`}
                aria-describedby={`${name}-${option}-sentence`}
                onChange={() => pick(option)}
              />
              <span id={`${name}-${option}-name`} className="kasten-mode-name">
                {MODE_NAMES[option]}
              </span>
              <span id={`${name}-${option}-sentence`} className="kasten-mode-sentence">
                {MODE_SENTENCES[option]}
              </span>
            </label>
          ))}
        </div>
      </Block>
      {!view && !error && <Note>Reading how much agents may do…</Note>}
      {error && (
        <Note tone="danger">
          Could not read how much agents may do: {error}{" "}
          <Button size="sm" onClick={() => void useAgentMode.getState().load()}>
            Try again
          </Button>
        </Note>
      )}
      {view && mode === "autonomous" && (
        <Row id="agents.modeUntil" detail={view.active === "autonomous" ? `On ${untilWords(view.until, Date.now())}` : "Ended: back on Balanced"}>
          <Segmented label="For" value={boxOf(view.until, Date.now())} options={TIME_BOXES.map((b) => ({ id: b.id, label: b.label }))} onChange={(next) => void useAgentMode.getState().setMode("autonomous", next)} />
        </Row>
      )}
      {view && mode === "autonomous" && view.active !== "autonomous" && <Note tone="warning">The time you picked has run out, so agents are on Balanced again. Pick a time above to start another.</Note>}
      <Block id="agents.modeProjects" titled>
        {projects.length === 0 ? (
          <Extra>
            <p className="kasten-mode-empty">No projects yet. Once you have one, it can be given a mode of its own here.</p>
          </Extra>
        ) : (
          projects.map((project) => {
            const own = view?.projects[project.folder] ?? INHERIT;
            return (
              <div key={project.folder} className="kasten-mode-project">
                <span className="kasten-mode-project-name">{project.title}</span>
                <select
                  className="ui-field kasten-set-select"
                  aria-label={`Agents in ${project.title}`}
                  disabled={!view}
                  value={own}
                  onChange={(e) => void useAgentMode.getState().setProjectMode(project.folder, e.target.value === INHERIT ? null : (e.target.value as AgentMode))}
                >
                  <option value={INHERIT}>Same as everything ({MODE_NAMES[mode]})</option>
                  {AGENT_MODES.map((option) => (
                    <option key={option} value={option}>
                      {MODE_NAMES[option]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })
        )}
      </Block>
      <Extra>
        <p className="kasten-mode-foot">The time you pick covers everything set to Autonomous, projects included. While it is on, a small icon in the top bar says so and turns it off in one click.</p>
      </Extra>
    </Group>
  );
}
