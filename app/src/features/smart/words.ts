// The plain words smart pages use in the app's own chrome (not the page's).

/** An agent's client name as a person reads it: "claude-code" is "Claude Code". */
export function clientWords(client: string): string {
  const words = client
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(" ") : "an agent";
}

/** The sentence an agent-made page waits behind. */
export const allowLine = (madeBy: string) => `Made by ${clientWords(madeBy)}`;

/** The same, when History is off and nothing says who made the page. */
export const UNKNOWN_MAKER_LINE = "Not known who made this";

/** What "Allow to run" means, in plain words: it covers the page's code as it changes, not one version. */
export const ALLOW_NOTE =
  "It has not run yet. It runs in a closed-off area, and it can read and change your notes only the way an agent can, under the same rules. Allowing it covers its code from now on, also what an agent adds to it later.";

/** Added when History is off: why nobody can tell who made the page. */
export const UNKNOWN_MAKER_NOTE = "History is off, so KastenFlow cannot tell who made it. Turn History on in Settings to see that.";

/** Shown where a page would be, while smart pages are turned off. */
export const OFF_LINE = "Smart pages are off";

/** The same, when it is the page's project that turned them off. */
export const OFF_PROJECT_LINE = "Smart pages are off in this project";

/** Why a page with no view shows nothing, and what to do. */
export const NO_VIEW_LINE = "This smart page has no view yet. Ask an agent to build one, or read its notes.";

/** What ticking "Allow pictures from the web" means, in plain words. */
export const PICTURES_WARNING =
  "A picture's address can carry what the page has read, to any site. Allow this only for a page whose code you trust. It stays on only until the page's files change.";
