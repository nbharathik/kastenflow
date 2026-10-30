// The LaTeX plugin's Settings section: build while typing, and how long to
// wait after the last key (300 to 2000 ms).

import { Group, resetOf, Row, Switch } from "../../features/workspace/views/settings/parts";
import { clampDelay, MAX_DELAY, MIN_DELAY, USUAL_DELAY, useLatexPrefs } from "./prefs";

export function LatexSection() {
  const prefs = useLatexPrefs();
  return (
    <Group title="LaTeX">
      <Switch label="Build while I type" help="Builds the document a moment after you stop typing, so the PDF follows your text. Turn it off to build only with Build or Ctrl+Enter." checked={prefs.autoBuild} usual onChange={(autoBuild) => prefs.set({ autoBuild })} />
      <Row label="Wait after typing" help={`How long to wait after the last key before a build starts, from ${MIN_DELAY} to ${MAX_DELAY} milliseconds.`} {...resetOf(prefs.delayMs, USUAL_DELAY, (delayMs: number) => prefs.set({ delayMs }))}>
        <input
          type="number"
          className="ui-field w-24"
          aria-label="Wait after typing, in milliseconds"
          min={MIN_DELAY}
          max={MAX_DELAY}
          step={100}
          disabled={!prefs.autoBuild}
          value={prefs.delayMs}
          onChange={(e) => prefs.set({ delayMs: clampDelay(e.target.valueAsNumber) })}
        />
      </Row>
    </Group>
  );
}
