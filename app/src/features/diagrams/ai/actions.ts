// What a person can ask AI to do with a diagram, from the places that show
// one: the editor's header, the Diagrams view, and the picker that Insert →
// Diagram… opens in a deck. All of it is the chat's: the diagram is attached as
// context (its cells, ids and the checks' findings), the model changes it with
// the diagram tools, and what it changes waits in the chat's change bar to be
// looked at and applied. Nothing here writes a diagram.

import { useShell } from "../../../lib/store";
import { diagramChip } from "../../chat/context";
import { prefillMessage } from "../../chat/message-drafts";
import { runInChat } from "../../chat/run-action";
import { useChat } from "../../chat/store";
import type { Chip } from "../../chat/thread";
import { currentSlideChip } from "../../slides/ai-thread";
import { useDecks } from "../../slides/store";

/** The diagram an action is about. */
export interface Named {
  path: string;
  title: string;
}

/** The chat's message box, once the dock has it on the page. */
const messageBox = () => document.querySelector<HTMLTextAreaElement>('.kasten-chat-dock textarea[aria-label="Message"]');

/** Puts the cursor in the message box, which the dock may take a few frames to show. */
function focusMessageBox(tries = 8): void {
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    const box = messageBox();
    if (box) {
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    } else if (tries > 0) focusMessageBox(tries - 1);
  });
}

/** A new chat in the dock about `chips`, with `words` ready in its message box and the cursor after them: the person finishes the sentence. */
export function startDraft(chips: Chip[], words: string): string {
  const id = useChat.getState().start({ context: chips, open: true, follow: false });
  useShell.getState().toggleChat(true);
  prefillMessage(id, words);
  focusMessageBox();
  return id;
}

/** "Draw with AI" on an open diagram: a chat about it, ready for what to change. */
export const drawWithAi = (diagram: Named): string => startDraft([diagramChip(diagram)], "Change this diagram: ");

/** "Draw with AI" from the Diagrams view: a chat with nothing attached, ready for what to draw. */
export const drawFromScratch = (): string => startDraft([], "Draw a diagram of ");

/** Checks the diagram with the diagram tools, fixes what has one obvious fix and says the rest. */
export const checkWithAi = (diagram: Named): Promise<boolean> => runInChat("check-diagram", [diagramChip(diagram)]);

/** Explains the diagram in words; changes nothing. */
export const explainWithAi = (diagram: Named): Promise<boolean> => runInChat("explain-diagram", [diagramChip(diagram)]);

/** Tidies the diagram's layout through the diagram tools, as a change to look at first. */
export const tidyWithAi = (diagram: Named): Promise<boolean> => runInChat("tidy-diagram", [diagramChip(diagram)]);

/** "Draw with AI" from Insert → Diagram… in the deck at `deck`: a diagram of the slide the person is looking at (when the assistant tab has
 * told the chat which), else of the deck. Without a deck, a chat ready for what to draw. */
export async function drawForSlide(deck: string | undefined): Promise<boolean> {
  if (!deck) {
    drawFromScratch();
    return true;
  }
  const title = useDecks.getState().list.find((d) => d.path === deck)?.title ?? deck.slice(deck.lastIndexOf("/") + 1).replace(/\.deck$/, "");
  const attached: Chip = currentSlideChip(deck) ?? { kind: "deck", label: title, ref: [deck] };
  return runInChat("draw-diagram", [attached]);
}
