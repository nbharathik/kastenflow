// The AI actions the app ships with, as the browser preview and the tests
// have them. The app reads its own from the backend (`ai_actions`), where they
// are files; this is the same fourteen, so the editor's and the reader's menus can
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
  {
    ...base,
    slug: "layout-page",
    title: "Lay out this page",
    icon: "layout",
    needs: ["page"],
    optional: [],
    writes: "propose",
    where: ["editor", "chat"],
    instruction:
      "Lay out the attached page so it is easier to scan, without changing its words. Read it first with read_page_blocks, then make one edit_page call that holds all your steps. Use the steps that fit: wrap_columns to set short neighbouring blocks, or two embedded views, side by side; callout for a summary or a warning; toggle to fold long details the reader does not need first; embed to show a live view; move to bring the most important block to the top. Leave headings, code, tables and every block you do not name as they are. Do not change the page's words, only how it is arranged. If a step is refused as changed since you read it, read the page again and redo it with the new ids. Then say in two sentences what you arranged. If the page is already well laid out, say so and change nothing. If no page is attached, ask which one.",
  },
  {
    ...base,
    slug: "fix-latex-errors",
    title: "Fix LaTeX errors",
    icon: "wand",
    needs: ["sources"],
    optional: ["selection"],
    writes: "propose",
    where: ["latex"],
    instruction:
      "Fix the errors in the attached LaTeX file. The last build's errors are listed with it, each with its file and line. If what is attached is not enough, read the build with latex_build and the file with latex_read. Start with the first error, because later ones often come from it. Fix each error with the smallest change, using latex_edit: search is the exact text to replace, and base_hash is the hash latex_read gave. Read the build again when you are done. If a selection is attached, fix only the errors inside it. Leave the wording, the packages and the class as they are unless an error needs them changed, and never take text out just to make an error go away. Then say in a few sentences what was wrong and what you changed. If an error needs a decision from me, say what you would suggest instead of guessing. If the build has no errors, say so and change nothing.",
  },
  {
    ...base,
    slug: "make-smart-page",
    title: "Make a smart page from this",
    icon: "layout",
    needs: ["page"],
    optional: ["selection"],
    writes: "propose",
    where: ["editor", "chat"],
    instruction:
      "Make a smart page from the attached page or selection: a live page that reads the user's notes and shows them as a dashboard, tracker, map, timeline, calendar, board or gallery. First decide what it should show and which tag of notes it reads, and look at those notes with query_tag so you use the properties they really have. If what is attached is prose rather than data to show, say that a normal page fits better and change nothing. Read the kit reference in the resource kasten://smart/kit, start from its nearest example, and make the page in one smart_create call. Never write the data into the page: dates, places and statuses come from notes, and the page has no network. Then run smart_check and fix every error with smart_edit. Finish with two sentences: what the page shows and which tag and properties it reads, and that you could not run it yourself. If nothing is attached, ask what the page should show.",
  },
  {
    ...base,
    slug: "improve-smart-layout",
    title: "Improve this smart page's layout",
    icon: "layout",
    needs: ["page"],
    optional: [],
    writes: "propose",
    where: ["smart"],
    instruction:
      "Improve the layout of the attached smart page without changing what data it shows. If the attached page is not a smart page, say so and change nothing. Read it first with smart_read, which gives each file and its hash. Change only how things are arranged, in index.html and in app.js, using smart_edit: put the most important section first, group related components, give every component a label and every section a heading, use the kit's components instead of hand-made markup, show a plain message when there are no notes, and set a size that fits so nothing scrolls inside the page. Never write data into the code and never add network use. Run smart_check when you are done and fix what it reports. Then say in two sentences what you moved. If the layout is already good, say so and change nothing.",
  },
  {
    ...base,
    slug: "fix-smart-errors",
    title: "Fix its errors",
    icon: "wand",
    needs: ["page"],
    optional: [],
    writes: "propose",
    where: ["smart"],
    instruction:
      "Fix the errors of the attached smart page. If the attached page is not a smart page, say so and change nothing. Call smart_read: it lists the problems with the page and the errors the page reported when the app ran it, each with its file and line, and gives each file's hash. Run smart_check as well. Start with the first error, because later ones often come from it. Fix each error with the smallest change, using smart_edit: the text to replace must be in the file once, and base_hash is the hash smart_read gave. Run smart_check again when you are done. Never take a component or its data out just to make an error go away, and never write data into the code or add network use. If an error needs a decision from me, say what you would suggest instead of guessing. Then say in a few sentences what was wrong and what you changed. If there are no errors, say so and change nothing.",
  },
];

export const BUILT_IN_CATALOG: ActionCatalog = { actions: BUILT_IN_ACTIONS, problems: [] };
