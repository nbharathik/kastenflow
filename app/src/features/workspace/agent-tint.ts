// The page's optional tint on what an agent wrote today: a switch in the page
// menu, off by default. The styling reads this attribute on the document
// (pages/editor/styles/agent.css), so every open page follows at once.

/** Turns the tint on or off for every page in the window. */
export function applyAgentTint(on: boolean): void {
  if (typeof document !== "undefined") document.documentElement.dataset.agentTint = on ? "on" : "off";
}
