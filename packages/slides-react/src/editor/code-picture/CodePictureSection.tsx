import type { JSX } from "react";

import { PanelSection } from "../panels/format/PanelSection.tsx";
import type { SectionProps } from "../panels/format/types.ts";
import { TextButton } from "../ui/Button.tsx";
import { generatorOf } from "./model.ts";
import { type RunReport, runPicture } from "./run.ts";
import { setTarget } from "./target.ts";
import "./code-picture.css";

/** What a run that did not draw says to a person who pressed "Run again" without the panel open. */
export function runWords(report: RunReport): string | null {
  switch (report.status) {
    case "done":
      return report.unchanged ? "The picture is the same: the code and what it reads have not changed." : null;
    case "error":
      return `${report.error.line ? `Line ${report.error.line}: ` : ""}${report.error.message}`;
    case "needs-allow":
      return "An agent wrote this code. Open Edit code and press Allow to run.";
    default:
      return report.why;
  }
}

/** The format panel's section for a code picture: that it is made by code, and the ways to its code. Only where the host runs code. */
export function CodePictureSection({ session, ui, elements }: SectionProps): JSX.Element | null {
  const only = elements.length === 1 ? elements[0] : undefined;
  const generator = generatorOf(only);
  if (!only || !generator || !session.host.runGenerator) return null;
  const slideId = session.state.slideId;
  return (
    <PanelSection id="code-picture" title="Code">
      <p className="ks-cp-hint-line">
        Made by code ({generator.output === "png" ? "PNG" : "SVG"}){generator.madeBy ? `, written by an agent` : ""}.
      </p>
      <div className="ks-cp-section-code">
        <TextButton
          onClick={() => {
            setTarget(ui, { kind: "edit", slideId, id: only.id });
            ui.openDialog("code-picture");
          }}
        >
          Edit code…
        </TextButton>
        <TextButton
          onClick={() =>
            void runPicture(session, slideId, only.id).then((report) => {
              const said = runWords(report);
              if (said) session.host.notify?.(said);
            })
          }
        >
          Run again
        </TextButton>
      </div>
    </PanelSection>
  );
}
