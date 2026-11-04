import type { JSX } from "react";
import { useState } from "react";

import { importCaptionsFile } from "../dialogs/captions-file.ts";
import type { EditorSession } from "../session/session.ts";
import { TextButton } from "../ui/Button.tsx";
import type { AccessProblem } from "./check.ts";

/** Goes to the problem: the slide, and the element when it is about one. */
export function showProblem(session: EditorSession, problem: AccessProblem): void {
  session.goTo(problem.slide);
  if (problem.element) session.select([problem.element]);
}

/** One problem, in words, with a way to see it and the fix that suits it. */
export function ProblemRow({ session, problem }: { session: EditorSession; problem: AccessProblem }): JSX.Element {
  const [words, setWords] = useState("");
  const { slide, element } = problem;

  let fix: JSX.Element | null = null;
  if (problem.rule === "slide-title") {
    fix = (
      <div className="ks-ac-fix">
        <input className="ks-ac-input" aria-label={`Hidden title for slide ${problem.number}`} placeholder="Title for screen readers" value={words} onChange={(event) => setWords(event.target.value)} />
        <TextButton disabled={words.trim() === ""} onClick={() => session.access.setTitle(slide, words)}>
          Add hidden title
        </TextButton>
      </div>
    );
  } else if (problem.rule === "missing-alt" && element) {
    fix = (
      <div className="ks-ac-fix">
        <input className="ks-ac-input" aria-label="Alt text" placeholder="Describe it in a few words" value={words} onChange={(event) => setWords(event.target.value)} />
        <TextButton disabled={words.trim() === ""} onClick={() => session.access.describe(slide, element, words)}>
          Save
        </TextButton>
        <TextButton onClick={() => session.access.markDecorative(slide, [element])} title="It is only decoration, so a screen reader skips it">
          Decorative
        </TextButton>
      </div>
    );
  } else if (problem.rule === "table-header" && element) {
    fix = (
      <div className="ks-ac-fix">
        <TextButton onClick={() => session.access.makeHeader(slide, element)}>Make first row a header</TextButton>
      </div>
    );
  } else if (problem.rule === "video-captions" && element) {
    fix = (
      <div className="ks-ac-fix">
        <TextButton
          onClick={async () => {
            const path = await importCaptionsFile(session);
            if (path) session.access.setCaptions(slide, element, path);
          }}
        >
          Add captions…
        </TextButton>
      </div>
    );
  }

  return (
    <li className="ks-ac-problem" data-rule={problem.rule}>
      <div className="ks-ac-what">
        <span className="ks-ac-message">{problem.message}</span>
        {problem.hint ? <span className="ks-ac-hint">{problem.hint}</span> : null}
      </div>
      <div className="ks-ac-actions">
        <TextButton onClick={() => showProblem(session, problem)} aria-label={`Show on slide ${problem.number}: ${problem.message}`}>
          Show
        </TextButton>
      </div>
      {fix}
    </li>
  );
}
