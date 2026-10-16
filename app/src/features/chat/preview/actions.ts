// The AI actions the app ships with, as the browser preview and the tests
// have them. The app reads its own from the backend (`ai_actions`), where they
// are files; this is the same nine, so the editor's and the reader's menus can
// be tried without it.

import type { ActionCatalog, AiAction } from "../types";

const base = { version: 1, builtIn: true, path: null } as const;

export const BUILT_IN_ACTIONS: AiAction[] = [
  {
    ...base,
    slug: "explain",
    title: "Explain",
    icon: "bulb",
    needs: ["selection"],
    optional: ["nearby", "page"],
    writes: "none",
    where: ["editor", "chat", "pdf"],
    instruction:
      "Explain the selected text in plain language: what it says, why it matters where it appears, and any term a newcomer might not know. Keep it short, and say so if the text is unclear or seems wrong.",
  },
  {
    ...base,
    slug: "compare-sources",
    title: "Compare sources",
    icon: "layers",
    needs: ["sources"],
    optional: ["selection"],
    writes: "none",
    where: ["chat", "pdf"],
    instruction:
      "Compare the attached sources. Say in a line what each one argues or shows; then set out where they agree, where they differ, and what each leaves open. Name the source whenever you quote or refer to it. If a selection is given, treat it as the question to answer across the sources.",
  },
  {
    ...base,
    slug: "outline",
    title: "Outline",
    icon: "list",
    needs: ["page"],
    optional: ["selection"],
    writes: "insert",
    where: ["editor", "chat"],
    instruction:
      "Write an outline of the page as nested bullets: the main sections first, with their key points underneath. Use the page's own words and headings where it has them. If a selection is given, outline only that.",
  },
  {
    ...base,
    slug: "extract-action-items",
    title: "Extract action items",
    icon: "todo",
    needs: ["page"],
    optional: ["selection"],
    writes: "insert",
    where: ["editor", "chat"],
    instruction:
      "Find what someone has to do in the text and list each item as a Markdown to-do, starting with a verb. Add an owner or a date only where the text names one. If the text holds no action items, say so in one sentence instead of inventing any. If a selection is given, look only there.",
  },
  {
    ...base,
    slug: "draft-project-update",
    title: "Draft project update",
    icon: "project",
    needs: ["project"],
    optional: ["journal", "page", "selection"],
    writes: "insert",
    where: ["editor", "chat"],
    instruction:
      "Draft a short update on the project for someone who has not followed it: what moved, what is blocked or at risk, and what comes next. Base it only on the attached pages and journal, and leave out anything they do not support rather than guessing.",
  },
  {
    ...base,
    slug: "draw-diagram",
    title: "Draw a diagram",
    icon: "diagram",
    needs: [],
    optional: ["page", "selection", "sources"],
    writes: "propose",
    where: ["chat"],
    instruction:
      "Draw a diagram of what the attached page, selection or sources describe, using the diagram tools. Choose the kind that fits: a flowchart for steps and decisions, an architecture diagram for parts that talk to each other, a sequence diagram for messages between parties over time, an entity diagram for data, a mind map for ideas. Keep it readable: one idea to a box, short labels, a label on every arrow that needs one, and about a dozen boxes unless the content needs more. Make it with diagram_new from a spec, and look up shapes with diagram_find_shapes only when a box needs a special one. Then run diagram_lint and put right what it reports with diagram_edit. Never write the diagram's XML. Finish with two sentences: what the diagram shows, and anything you left out. If nothing is attached, ask what to draw instead of guessing.",
  },
  {
    ...base,
    slug: "explain-diagram",
    title: "Explain this diagram",
    icon: "bulb",
    needs: ["sources"],
    optional: [],
    writes: "none",
    where: ["chat"],
    instruction:
      "Explain the attached diagram in plain language: what it shows, how its parts connect (follow the arrows in order), and anything that looks missing, unclear or inconsistent. Name a box by its label and mention an id only when it is needed to point at one. If what is attached is not enough, read the diagram with diagram_describe. Do not change the diagram.",
  },
  {
    ...base,
    slug: "tidy-diagram",
    title: "Tidy this diagram",
    icon: "layout",
    needs: ["sources"],
    optional: [],
    writes: "propose",
    where: ["chat"],
    instruction:
      "Tidy the layout of the attached diagram without changing what it says. Call diagram_edit once with a single layout step, in the diagram's own direction (LR for a flow that runs left to right, TB for one that runs top to bottom), and with no other step. Then say in one sentence what moved. If the diagram is already tidy, say so and change nothing. Do not rename, add or remove anything.",
  },
  {
    ...base,
    slug: "check-diagram",
    title: "Check this diagram",
    icon: "circle-check",
    needs: ["sources"],
    optional: [],
    writes: "propose",
    where: ["chat"],
    instruction:
      "Check the attached diagram with diagram_lint. List what is wrong, most important first, each with the box or arrow it is about. Fix the problems that have one obvious fix (an arrow that ends nowhere, a box with no label, boxes lying on top of each other) with diagram_edit, and leave anything that needs a judgement to me: say what you would suggest instead. Do not remove a box or an arrow the diagram needs.",
  },
];

export const BUILT_IN_CATALOG: ActionCatalog = { actions: BUILT_IN_ACTIONS, problems: [] };
