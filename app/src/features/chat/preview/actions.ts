// The AI actions the app ships with, as the browser preview and the tests
// have them. The app reads its own from the backend (`ai_actions`), where they
// are files; this is the same twenty-three, so the editor's and the reader's menus can
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
      "Fix the errors of the attached LaTeX document, in the attached file and in any other file the build names. The attached text shows the lines near each problem, with its file and line and what TeX printed where it stopped. If that is not enough, read more with latex_read (around_line or lines gives numbered lines) and the build with latex_build. Start with the first error, because later ones often come from it. Fix each with the smallest change, using latex_edit: search is the exact text to replace, without the line numbers, and base_hash is the hash latex_read gave. Then check your work: call latex_build with wait set to true and compare the error counts. If errors remain that your changes did not cause, try once more, then stop. If there is no engine to build with, say so plainly and stop. Leave the wording, the packages and the class as they are unless an error needs them changed, and never take text out just to make an error go away. If a selection is attached, fix only the errors inside it. End with one line such as “3 errors → 0” (before and after; say it is a preview if my changes still wait for review), then a few sentences on what was wrong and what you changed. These are suggestions and may be wrong, for example with macros I wrote myself; if an error needs a decision from me, say what you would suggest. If the build has no errors, say so and change nothing.",
  },
  {
    ...base,
    slug: "fix-latex-error",
    title: "Fix this problem",
    icon: "wand",
    needs: ["sources"],
    optional: [],
    writes: "propose",
    where: ["latex"],
    instruction:
      "Fix only the one problem quoted after these words, in the attached LaTeX file or the file it names. The attached text shows the lines near it and what TeX printed where it stopped; if that is not enough, read more with latex_read (around_line gives numbered lines). Find the cause and fix it with the smallest change, using latex_edit: search is the exact text to replace, without the line numbers, and base_hash is the hash latex_read gave. Leave everything else as it is. Then call latex_build with wait set to true, and tell me whether this problem is gone and how many errors the build has now, such as “3 errors → 2”. If there is no engine to build with, say so plainly. Say in two sentences what was wrong and what you changed. This is a suggestion and may be wrong, for example when the problem comes from a macro I wrote myself; if you are not sure, say what you would try instead of guessing.",
  },
  {
    ...base,
    slug: "explain-latex-error",
    title: "Explain this problem",
    icon: "bulb",
    needs: ["sources"],
    optional: [],
    writes: "none",
    where: ["latex"],
    instruction:
      "Explain the one problem quoted after these words in plain language: what TeX is complaining about, why it happens at that line, and how it is usually put right. Use the attached lines near it, and read more with latex_read (around_line gives numbered lines) if you need to. Point at the exact line, and give one suggested fix as a line of LaTeX. Do not change any file. Keep it to a short paragraph. This is an explanation and may be wrong: if the cause may be a macro or package I wrote myself, or the lines shown do not make it clear, say so.",
  },
  {
    ...base,
    slug: "fix-overfull-boxes",
    title: "Fix overfull boxes",
    icon: "wand",
    needs: ["sources"],
    optional: ["selection"],
    writes: "propose",
    where: ["latex"],
    instruction:
      "Fix the overfull boxes of the attached LaTeX document: lines that stick out into the margin. The last build lists them (read it with latex_build if it is not attached), each with its file and the lines of its paragraph. For each one read those lines with latex_read (around_line gives numbered lines) and choose the gentlest cure: let a long word or web address break (\\url, \\allowbreak, a hyphenation hint such as \\-), reword a few words only if the meaning stays the same, or for a wide table or equation use a smaller font, a narrower column or a split. Make each change with latex_edit: search is the exact text, without the line numbers, and base_hash is the hash latex_read gave. Do not change the margins, the class or the packages to hide them. Then call latex_build with wait set to true and finish with the count, such as “7 overfull boxes → 2”. Say what you left and why. These are suggestions and may be wrong.",
  },
  {
    ...base,
    slug: "check-latex-refs",
    title: "Check references and labels",
    icon: "circle-check",
    needs: ["sources"],
    optional: [],
    writes: "propose",
    where: ["latex"],
    instruction:
      "Check that every \\ref, \\eqref, \\cref and \\cite of the attached LaTeX document has something to point at, and say which labels are never used. The attached text ends with a map of the document: its files, labels, bibliography keys, and the references and citations that point at nothing. If the map is missing or cut, read the files with latex_read. For a reference that points at nothing, look for a label that is nearly the same (a typo, or a prefix such as fig: or eq:) and fix the reference with latex_edit when one match is clear: search is the exact text, base_hash is the hash latex_read gave. If there is no match, tell me instead of inventing a label. Do not add or remove labels, and do not change a citation key unless one entry in the bibliography is clearly the one meant. Finish with a short list: what you fixed, what is left for me, and the labels never used.",
  },
  {
    ...base,
    slug: "find-missing-citations",
    title: "Find missing citations",
    icon: "book",
    needs: ["sources"],
    optional: ["selection"],
    writes: "propose",
    where: ["latex"],
    instruction:
      "Find the claims in the attached LaTeX document that need a citation, and the citations that have no entry. Start from the map at the end of the attached text: the keys cited and the keys in the bibliography. Then look through my References with list_references for entries that fit a claim. For a reference that fits, add it with latex_cite (it writes the \\cite and keeps the entry in the bibliography once). Never invent a reference, an author or a key. If nothing in my References fits a claim, say which claim it is and what kind of source it needs. Do not change the text around a citation. If a selection is attached, look only there. Finish with a short list: what you cited, what is still missing, and cited keys that have no entry.",
  },
  {
    ...base,
    slug: "draft-latex-section",
    title: "Draft a section from a page",
    icon: "layout",
    needs: ["sources"],
    optional: ["page", "selection"],
    writes: "propose",
    where: ["latex"],
    instruction:
      "Draft a section of the attached LaTeX document from a page of my notes. If I have not named or attached the page, ask which one. Read the page with read_note, and the document's file with latex_read to see its class, packages, labels and the way its sections are written. Write the section in LaTeX that matches the document: the same heading level and style, a \\label on the section and on each figure and table, and \\cite only for a reference whose key is in my References (list_references). Keep my meaning and my numbers, and add no claim the page does not make. Put it in the right place with latex_append (after is the text it should follow), then call latex_build with wait set to true to check it. Say what you drafted and anything you left out. This is a draft and may be wrong.",
  },
  {
    ...base,
    slug: "table-to-booktabs",
    title: "Page table to booktabs",
    icon: "list",
    needs: ["sources"],
    optional: ["page", "selection"],
    writes: "propose",
    where: ["latex"],
    instruction:
      "Turn a table of a page of my notes into a LaTeX table in the attached document. If I have not named or attached the page and the table, ask. Read the page with read_note. Write a table environment with \\centering, a \\caption and a \\label, and a tabular that uses the booktabs rules (\\toprule, \\midrule, \\bottomrule) and no vertical lines; align numbers to the right and text to the left; escape the special characters (& % $ # _ { } ~ ^). Make sure the document loads the booktabs package, and add \\usepackage{booktabs} with latex_edit if it does not (search is the exact text, base_hash the hash latex_read gave). Put the table in with latex_append (after is the text it should follow), then call latex_build with wait set to true. Do not change the table's values. Say what you added.",
  },
  {
    ...base,
    slug: "figure-from-diagram",
    title: "Figure from a diagram",
    icon: "diagram",
    needs: ["sources"],
    optional: ["selection"],
    writes: "propose",
    where: ["latex"],
    instruction:
      "Put a diagram of mine into the attached LaTeX document as a figure. The words quoted after these, if any, name the diagram; if they do not, or the name matches several, look with list_diagrams and ask me which one. Make the figure with diagram_to_latex_figure: the app draws the diagram as a PNG, keeps it in the document's figures folder and gives back the \\includegraphics line, with the width you ask for (use \\linewidth or a fraction of it). Wrap it in a figure environment with \\centering, a short \\caption taken from what the diagram shows and a \\label, and put it where the text refers to it, or at the cursor line if a selection is attached, using latex_edit (search is the exact text, base_hash the hash latex_read gave). Never write the picture's bytes yourself. Then call latex_build with wait set to true to check it. Say what you added. This may be wrong: check the caption.",
  },
  {
    ...base,
    slug: "latex-inline",
    title: "Write LaTeX in place",
    icon: "wand",
    needs: [],
    optional: ["selection", "nearby", "sources"],
    writes: "insert",
    where: ["latex"],
    instruction:
      "Write LaTeX for the request that comes after these words. If a selection is attached, your answer replaces it; if not, your answer is put at the cursor, so write only what belongs there. Use the text around it to match the document's style, macros and packages. The attached file lists its labels and citation keys: use them, and invent none. Escape special characters and close every environment you open. Add no \\documentclass, no \\begin{document} and no package unless the request needs one; if it does, put the \\usepackage line in a % comment on its own line above the code. Answer with the LaTeX only: no greeting, no explanation and no code fence.",
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
