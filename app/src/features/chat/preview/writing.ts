// What AI writes in the browser preview's page editor, where no provider is
// reached: answers made from the page itself, so the flow can be tried.
// The app asks the person's own provider instead.

import type { ActionRun, WriteRequest } from "../types";

/** The sentences of `text`, without Markdown's marks. */
function sentences(text: string): string[] {
  const plain = text
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (plain.match(/[^.!?]+[.!?]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ended = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** What an AI action answers in the preview: the page's own text shaped as
 * the action asks (a list of bullets for the ones that write), or an
 * explanation of the selection. */
export function cannedAction(run: ActionRun): string {
  const text = (run.selection || run.page || "").trim();
  const said = sentences(text);
  switch (run.action) {
    case "explain":
      return cannedWriting({ id: run.id, provider: run.provider, model: run.model, action: "explain", instruction: run.instruction ?? "", title: run.title ?? "", selection: text, before: run.before ?? "", after: run.after ?? "" });
    case "outline":
      return said.length ? said.slice(0, 5).map((s) => `- ${ended(capital(s.length > 80 ? `${s.slice(0, 78).trimEnd()}…` : s))}`).join("\n") : "- Nothing to outline yet.";
    case "extract-action-items":
      return said.length ? said.slice(0, 3).map((s) => `- [ ] ${capital(s.replace(/[.!?]+$/, ""))}`).join("\n") : "There are no action items in this text.";
    default:
      return said.length ? said.slice(0, 3).map((s) => `- ${ended(capital(s))}`).join("\n") : "The preview has nothing to base this on.";
  }
}

export function cannedWriting(request: WriteRequest): string {
  const said = sentences(request.selection);
  const asked = request.instruction.toLowerCase();
  switch (request.action) {
    case "summarize": {
      const points = said.slice(0, 3).map((s) => `- ${ended(capital(s.length > 90 ? `${s.slice(0, 88).trimEnd()}…` : s))}`);
      return points.length ? points.join("\n") : "- This page is short: one idea so far.";
    }
    case "explain": {
      // An answer to the person, not text for the page.
      const first = said[0] ?? request.selection.trim();
      const short = first.length > 120 ? `${first.slice(0, 118).trimEnd()}…` : first;
      const around = request.scope === "page" ? "read against the whole page" : "read against the text around it";
      return [`**In plain words:** ${ended(capital(short))}`, "", `That is ${around}. In the app, your AI provider writes this explanation; the preview only shows how it is laid out.`].join("\n");
    }
    case "continue":
      return "Next, note what you learned while it is fresh, and one thing you would do differently next time.";
    case "ask":
      if (!said.length) return [`- A first step for “${request.instruction.trim()}”`, "- What would make it easier?", "- Who could help, and by when?"].join("\n");
      if (/list|bullet|points/.test(asked)) return said.map((s) => `- ${ended(capital(s))}`).join("\n");
      if (/short|brief|concise/.test(asked)) return ended(capital(said[0]!));
      return said.map((s) => ended(capital(s))).join(" ");
  }
}
