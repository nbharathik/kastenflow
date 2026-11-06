// Commands for help from the host's assistant inside the editor (rewrite, shorten, bullets, grammar, a layout, speaker notes, a deck
// from a note, a check of the deck), and the brand kit. The assistant changes the deck through its own tools; the editor only asks.

import type { AiTask } from "../ai/ai-host.ts";
import { TASK_LABELS, WORD_TASKS, promptFor } from "../ai/prompts.ts";
import { slideTitle } from "../dialogs/slide-title.ts";
import { selectedElements } from "../session/scope.ts";
import type { IconName } from "../ui/icons.ts";
import type { Command, CommandContext } from "./types.ts";

/** Whether an element holds words an assistant could work on. */
const wordy = (type: string): boolean => type === "text" || type === "shape" || type === "table" || type === "code";

/** Asks the host's assistant for a task about the slide shown and what is selected; opens the assistant's tab so its answer is seen. */
export async function askAssistant({ session, ui }: CommandContext, task: AiTask): Promise<void> {
  const host = session.host.ai;
  if (!host) return;
  const slide = session.slide;
  const words = ui.state.text ? (window.getSelection()?.toString() ?? "").trim() : "";
  const page = task === "build" ? await session.host.pickPage?.() : undefined;
  // Building from a note starts with choosing the note; leaving the choice is leaving the task.
  if (task === "build" && !page) {
    if (!session.host.pickPage) session.host.notify?.("Choose a note to build from needs a host with pages.");
    return;
  }
  const elementIds = [...session.state.selection];
  const prompt = promptFor(task, {
    slideNumber: session.deck.slides.findIndex((s) => s.id === slide.id) + 1,
    slideId: slide.id,
    slideTitle: slideTitle(slide),
    elementIds,
    ...(words ? { words } : {}),
    ...(page ? { page: { path: page.path, title: page.title } } : {}),
  });
  ui.openPanel("ai");
  const outcome = await host.ask({ task, prompt, deckPath: session.host.deckPath, slideId: slide.id, elementIds });
  if (outcome.status !== "sent") session.host.notify?.(outcome.message);
}

const ICONS: Record<AiTask, IconName> = { rewrite: "pen-line", shorten: "minus", bullets: "list", grammar: "check", layout: "layout-template", notes: "notebook-pen", build: "wand-sparkles", check: "circle-check" };

const taskCommand = (task: AiTask): Command => ({
  id: `ai.${task}`,
  label: TASK_LABELS[task],
  icon: ICONS[task],
  enabled: (state, ui, host) => {
    if (!host.ai) return false;
    if (task === "build") return host.pickPage !== undefined;
    if (!WORD_TASKS.includes(task)) return true;
    // Words to work on: some are selected in a box being edited, or an element that holds words is selected.
    return ui.text !== null || selectedElements(state).some((element) => wordy(element.type));
  },
  run: (context) => askAssistant(context, task),
});

export const aiCommands: Command[] = [
  ...(["rewrite", "shorten", "bullets", "grammar", "layout", "notes", "build", "check"] as const).map(taskCommand),
  {
    id: "deck.brand-kit",
    label: "Brand kit…",
    icon: "palette",
    enabled: (_state, _ui, host) => host.brand !== undefined,
    run: ({ ui }) => ui.openDialog("brand"),
  },
];
