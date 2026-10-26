// What the demo's chat says and proposes: a week plan with three to-dos drawn
// from the vault's own notes, and a short canned answer to anything else. Pure
// text, so the same request always gets the same words.

import type { ChatRequest } from "../types";

/** The request the demo is made to answer, as a recording types it. */
export const DEMO_PROMPT = "Plan next week from my notes";

/** The title of the page the chat proposes. */
export const PLAN_TITLE = "Week plan";

/** Whether a message asks for a plan of the week. */
export const isPlanRequest = (text: string): boolean => /\bplan\b[^.?!]*\bweek\b|\bweek\b[^.?!]*\bplan\b/i.test(text);

export interface WeekPlan {
  title: string;
  /** The page's Markdown, with its three to-dos. */
  body: string;
  tasks: string[];
}

const FALLBACK = ["Clear the Inbox", "Draft the weekly summary", "Review the week and back up the vault"];

/** The plan, from up to three note titles; fewer notes leave plain steps. */
export function weekPlan(notes: readonly string[]): WeekPlan {
  const tasks = [
    notes[0] ? `Pick up where [[${notes[0]}]] left off` : FALLBACK[0]!,
    notes[1] ? `Turn [[${notes[1]}]] into next steps` : FALLBACK[1]!,
    notes[2] ? `Review [[${notes[2]}]] and send the summary` : FALLBACK[2]!,
  ];
  const from = notes.length > 0 ? `Drafted from your notes: ${notes.map((n) => `[[${n}]]`).join(", ")}.` : "Drafted from your notes.";
  const body = [`# ${PLAN_TITLE}`, "", from, "", "## Monday", `- [ ] ${tasks[0]}`, "", "## Wednesday", `- [ ] ${tasks[1]}`, "", "## Friday", `- [ ] ${tasks[2]}`, ""].join("\n");
  return { title: PLAN_TITLE, body, tasks };
}

/** The staged file as the vault would hold it: the front matter a page starts with, then the body. */
export const fileText = (plan: WeekPlan, day: string): string => `---\ntype: page\ntitle: ${plan.title}\ncreated: ${day}\n---\n\n${plan.body}`;

export const planIntro = (notes: readonly string[]): string =>
  notes.length > 0
    ? `I read ${notes.length === 1 ? "your note" : `your ${notes.length} most relevant notes`} and drafted a plan for next week.\n\n`
    : "I looked through your notes and drafted a plan for next week.\n\n";

export const planStaged = (tasks: number): string => `\n\n${tasks} to-dos are staged in a new page, **${PLAN_TITLE}**. Nothing is in your notes until you apply them: review the changes above the message box, then Apply. One click on “Undo this chat's changes” takes it all back.`;

export const planWritten = (title: string, tasks: number): string => `\n\n[[${title}]] is in your notes now, with ${tasks} to-dos in Tasks. “Undo this chat's changes” below takes it back.`;

/** The answer to any other message. */
export function otherAnswer(request: Pick<ChatRequest, "context">): string {
  const selected = request.context.find((chip) => chip.kind === "selection")?.selection?.text.trim();
  if (selected) {
    const excerpt = selected.length > 160 ? `${selected.slice(0, 157)}…` : selected;
    return `Here is the gist of the passage you selected:\n\n> ${excerpt.replace(/\s*\n\s*/g, " ")}\n\nIt sets out what comes next and why. I can turn it into to-dos, or draft a short summary for the page. Which would you like?`;
  }
  return `I can read your pages, PDFs and slides, and propose changes you review before anything is written. Try “${DEMO_PROMPT}”.`;
}
