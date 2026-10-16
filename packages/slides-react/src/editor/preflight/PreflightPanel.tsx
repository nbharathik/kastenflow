import type { Deck } from "@kasten-slides/wasm";
import type { JSX } from "react";

import { slideTitle } from "../dialogs/slide-title.ts";
import { TextButton } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import type { PreflightIssue, PreflightReport } from "./types.ts";
import "./preflight.css";

export interface PreflightPanelProps {
  deck: Deck;
  /** What the check found; null while it has not finished. */
  report: PreflightReport | null;
  checking: boolean;
  /** Why the check could not be done, if it could not. */
  failed?: string | null;
  /** Goes to the slide and selects the element. */
  onShow(issue: PreflightIssue): void;
  /** Looks at the web addresses too (the person asked). */
  onCheckWeb?: () => void;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function Group({ deck, issues, title, onShow }: { deck: Deck; issues: PreflightIssue[]; title: string; onShow(issue: PreflightIssue): void }): JSX.Element | null {
  if (issues.length === 0) return null;
  const rows = issues.map((issue, i) => {
    const index = issue.slide === null ? -1 : deck.slides.findIndex((slide) => slide.id === issue.slide);
    const slide = deck.slides[index];
    const where = slide ? `Slide ${index + 1}: ${slideTitle(slide)}` : "The theme";
    return (
      <li key={`${issue.id}-${i}`} className={`ks-pf-issue is-${issue.severity}`}>
        <span className="ks-pf-sev" aria-label={issue.severity === "error" ? "Error" : "Warning"}>
          <Icon name={issue.severity === "error" ? "circle-x" : "triangle-alert"} size={14} />
        </span>
        <span className="ks-pf-what">
          <span className="ks-pf-where">{where}</span>
          <span className="ks-pf-message">{issue.message}</span>
          {issue.hint ? <span className="ks-pf-hint">{issue.hint}</span> : null}
        </span>
        <span className="ks-pf-rule">{issue.rule}</span>
        {slide ? (
          <button type="button" className="ks-btn ks-pf-go" aria-label={`Show on slide ${index + 1}: ${issue.message}`} onClick={() => onShow(issue)}>
            Show
          </button>
        ) : (
          <span />
        )}
      </li>
    );
  });
  return (
    <section className="ks-pf-group" aria-label={title}>
      <h3 className="ks-pf-heading">{title}</h3>
      <ul className="ks-pf-list">{rows}</ul>
    </section>
  );
}

/**
 * What a check before leaving found: the errors and then the warnings, each with a Show that goes to the slide and selects the element; what the
 * format will change in the deck; and what was not looked at. Read-only: nothing here changes the deck.
 */
export function PreflightPanel({ deck, report, checking, failed = null, onShow, onCheckWeb }: PreflightPanelProps): JSX.Element {
  if (failed) return <p className="ks-pf-note" role="alert">The deck could not be checked: {failed}</p>;
  if (!report || checking) return <p className="ks-pf-note" role="status">Checking the deck…</p>;
  const clean = report.errors.length === 0 && report.warnings.length === 0;
  const web = report.unchecked.some((note) => note.includes("web address"));
  return (
    <div className="ks-pf" data-format={report.format}>
      {clean ? (
        <p className="ks-pf-clean" role="status">
          Nothing to fix.
        </p>
      ) : (
        <p className="ks-pf-summary" role="status">
          {[report.errors.length > 0 ? plural(report.errors.length, "error", "errors") : "", report.warnings.length > 0 ? plural(report.warnings.length, "warning", "warnings") : ""].filter(Boolean).join(" and ")} found.
        </p>
      )}
      <Group deck={deck} issues={report.errors} title="Errors" onShow={onShow} />
      <Group deck={deck} issues={report.warnings} title="Warnings" onShow={onShow} />
      {report.reductions.length > 0 ? (
        <section className="ks-pf-group" aria-label="What changes in the file">
          <h3 className="ks-pf-heading">What changes in the file</h3>
          <ul className="ks-pf-reductions">
            {report.reductions.map((reduction) => (
              <li key={reduction.id}>
                <span className="ks-pf-what-it-is">
                  {reduction.what} ({reduction.count})
                </span>
                : {reduction.becomes}.
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.unchecked.length > 0 ? (
        <section className="ks-pf-group" aria-label="Not checked">
          <h3 className="ks-pf-heading">Not checked</h3>
          <ul className="ks-pf-unchecked">
            {report.unchecked.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {web && onCheckWeb ? (
            <TextButton onClick={onCheckWeb}>
              <Icon name="globe" size={14} /> Check web addresses
            </TextButton>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
