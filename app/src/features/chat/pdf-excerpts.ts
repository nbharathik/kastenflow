// The text of the PDF pages a chat's chips name. Only the window can read a
// PDF (pdf.js is here, and there is no PDF reader in the backend), so the
// pages go along with the message as excerpts. The reader's code, with pdf.js,
// is loaded only when a chip asks for it.

import type { Chip } from "./thread";
import type { Excerpt } from "./types";

/** The excerpts for the `pdf` chips in `chips`; none without such a chip. */
export async function excerptsFor(chips: readonly Chip[]): Promise<Excerpt[]> {
  if (!chips.some((chip) => chip.kind === "pdf")) return [];
  const { excerptsOf } = await import("../sources/reader/ai-context");
  return excerptsOf(chips);
}
