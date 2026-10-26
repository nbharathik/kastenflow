// The layout of one issue on the health page: a dot, the text (title, then the
// smaller summary, then the preview of a fix) and the actions in their own
// column, so the preview lines up with the text and the buttons never fall
// back to the left edge.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Issue } from "./health-sections";
import { IssueRow } from "./IssueRow";

afterEach(cleanup);

const COPY = "library/Plan (conflict 2026-10-11 09-30).md";
const ISSUE: Issue = {
  id: "conflict:1",
  text: COPY,
  detail: "A copy kept after a clash",
  go: { path: COPY },
  repair: { kind: "trash-copy", copy: COPY, original: "library/Plan.md" },
};

const row = () => document.querySelector("li.kasten-health-issue") as HTMLElement;
const part = (cls: string) => row().querySelector(`.${cls}`) as HTMLElement;

const renderRow = (issue: Issue = ISSUE) =>
  render(
    <ul>
      <IssueRow issue={issue} level="warn" context={{ editorInstalled: true }} onRepaired={() => {}} />
    </ul>,
  );

describe("an issue row", () => {
  it("has a dot, a text block and an actions column as direct children, in that order", () => {
    renderRow();
    const kids = [...row().children].map((c) => c.className.split(" ")[0]);
    expect(kids).toEqual(["kasten-health-issue-dot", "kasten-health-issue-text", "kasten-health-issue-actions"]);
    expect(part("kasten-health-issue-dot").getAttribute("aria-hidden")).toBe("true");
  });

  it("puts the title before the summary, as separate elements", () => {
    renderRow();
    const text = part("kasten-health-issue-text");
    const title = text.querySelector(".kasten-health-issue-title") as HTMLElement;
    const summary = text.querySelector(".kasten-health-issue-detail") as HTMLElement;
    expect(title.textContent).toBe(COPY);
    expect(summary.textContent).toBe("A copy kept after a clash");
    expect(title).not.toBe(summary);
    expect(title.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps both buttons in the actions column, a sibling of the text block", () => {
    renderRow();
    const actions = part("kasten-health-issue-actions");
    expect(actions.parentElement).toBe(row());
    expect(actions.querySelectorAll("button")).toHaveLength(2);
    expect(part("kasten-health-issue-text").querySelector("button")).toBeNull();
  });

  it("shows the preview inside the text block, not beside the row", () => {
    renderRow();
    expect(row().querySelector(".kasten-health-preview")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Preview the fix/ }));
    const preview = screen.getByRole("group", { name: "What the fix would do" });
    expect(part("kasten-health-issue-text").contains(preview)).toBe(true);
    expect(preview.parentElement).not.toBe(row());
  });

  it("draws an issue with no summary and no buttons without empty parts", () => {
    renderRow({ id: "x", text: "Nothing to do" });
    expect(row().querySelector(".kasten-health-issue-detail")).toBeNull();
    expect(row().querySelectorAll("button")).toHaveLength(0);
    expect(part("kasten-health-issue-actions")).toBeNull();
  });
});
