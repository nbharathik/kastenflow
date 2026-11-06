// What the editor says to the assistant for each help it offers. A request names the slide and the elements it is about, so it needs
// nothing the assistant cannot read from it; it tells the assistant to change the deck only through its tools (so its work is marked,
// can wait for review, and is undone with one step) and to say what it changed.

import type { AiTask } from "./ai-host.ts";

/** Where in the deck a request is about. */
export interface AiScope {
  slideNumber: number;
  slideId: string;
  slideTitle: string;
  /** The elements selected on the slide, by id. */
  elementIds: readonly string[];
  /** The words selected in a text box being edited, when there are some. */
  words?: string;
  /** The page a deck is built from. */
  page?: { path: string; title: string };
}

/** The tasks that work on words, and so need some selected. */
export const WORD_TASKS: readonly AiTask[] = ["rewrite", "shorten", "bullets", "grammar"];

/** What each task is called in a menu. */
export const TASK_LABELS: Readonly<Record<AiTask, string>> = {
  rewrite: "Rewrite",
  shorten: "Shorten",
  bullets: "Make bullets",
  grammar: "Fix grammar",
  layout: "Suggest a layout",
  notes: "Write speaker notes",
  build: "Build from a note…",
  check: "Check the deck",
};

const where = (scope: AiScope): string => `slide ${scope.slideNumber} (“${scope.slideTitle}”, id ${scope.slideId})`;

/** What a word task works on: the words selected, else the selected elements, else the whole slide. */
function target(scope: AiScope): string {
  if (scope.words?.trim()) return `these words on ${where(scope)}: “${scope.words.trim()}”`;
  if (scope.elementIds.length > 0) return `the text of the selected element${scope.elementIds.length === 1 ? "" : "s"} (${scope.elementIds.join(", ")}) on ${where(scope)}`;
  return `the text on ${where(scope)}`;
}

const SAFELY = "Change the deck only with your deck tools, so that I can see what you changed and undo it, and keep everything else as it is.";

/** The request for a task. */
export function promptFor(task: AiTask, scope: AiScope): string {
  switch (task) {
    case "rewrite":
      return `Rewrite ${target(scope)} so it reads better, keeping its meaning, its tone and about the same length. Change the words only: keep the formatting and the layout. ${SAFELY}`;
    case "shorten":
      return `Shorten ${target(scope)} by about a third, keeping the key points and dropping filler. Change the words only. ${SAFELY}`;
    case "bullets":
      return `Turn ${target(scope)} into short bullet points, one idea each, no more than about eight words a line. ${SAFELY}`;
    case "grammar":
      return `Fix the spelling, grammar and punctuation in ${target(scope)}. Change nothing else: not the wording, the style or the layout. ${SAFELY}`;
    case "layout":
      return `Suggest a better layout for ${where(scope)}: look at the slide as it is drawn, say in two sentences what you would change and why, then make that change with a layout of the deck's theme or by moving the elements, and run lint_deck on the slide. ${SAFELY}`;
    case "notes":
      return `Write speaker notes for ${where(scope)}: 60 to 120 words, in the first person, saying what I would say aloud rather than repeating the slide. Put them in the slide's notes. ${SAFELY}`;
    case "build": {
      const page = scope.page ? `the note “${scope.page.title}” (${scope.page.path})` : "the note I choose";
      return `Build slides from ${page}. First write an outline (a title for the deck and one line for each slide) and show it to me, then wait for my reply before you make any slide. After I agree, build the slides on the deck's own layouts with typed content, and run lint_deck. ${SAFELY}`;
    }
    case "check":
      return `Check this whole deck. Run lint_deck and fix what it reports, then look at each slide as it is drawn and fix what looks wrong: overlapping or cut-off text, empty slots, pictures without alternative text, layouts that differ for no reason. Then tell me in a short list what you changed and what you left for me to decide. ${SAFELY}`;
  }
}
