// What a host gives the editor so its menus can ask the host's assistant for help: rewrite the words that are selected, suggest a layout,
// write the speaker notes, build slides from a page, check the deck. The editor works out the request; the host answers by giving it to
// its assistant, which changes the deck through the same tools and modes it always does (marked for the person, waiting for review where
// the mode says so, and undone with one step). The editor never writes what the assistant answers into the deck itself.

/** What is asked for. */
export type AiTask = "rewrite" | "shorten" | "bullets" | "grammar" | "layout" | "notes" | "build" | "check";

/** One request, with where in the deck it is about. */
export interface AiRequest {
  task: AiTask;
  /** The request in words, ready to give an assistant. It names the slide and the elements, so it needs nothing else. */
  prompt: string;
  /** Where the deck is kept, as the host names decks; none when the host keeps it nowhere. */
  deckPath: string | undefined;
  slideId: string;
  elementIds: readonly string[];
}

/** What came of a request. `sent` means the assistant has it and will answer in its panel. */
export type AiOutcome = { status: "sent" } | { status: "unavailable" | "refused"; message: string };

export interface EditorAiHost {
  ask(request: AiRequest): Promise<AiOutcome>;
}
