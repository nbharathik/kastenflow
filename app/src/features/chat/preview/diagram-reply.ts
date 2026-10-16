// The preview's chat when it is asked to draw a diagram or to explain one. No model answers there, so the steps are scripted: "Draw a
// diagram" makes a real diagram in the preview vault from the headings of the attached page (a row of boxes joined by arrows), and
// "Explain this diagram" counts what the attached diagram holds. The tool call and its result are shown as the app shows them.

import { BLANK_DIAGRAM } from "../../../lib/vault/diagram-types";
import type { VaultClient } from "../../../lib/vault/types";
import type { ChatEvent, ChatRequest } from "../types";

const DRAW = /^\s*Draw a diagram of\b/i;
const EXPLAIN = /\bExplain the attached diagram\b/i;

const INTRO = "This is the **browser preview**, so no model answers here: the steps below are scripted, and the diagram is real.\n\n";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What a message asks of the scripted diagram steps, if it asks. */
export function diagramAsk(request: Pick<ChatRequest, "text" | "context">): "draw" | "explain" | null {
  if (DRAW.test(request.text)) return "draw";
  return EXPLAIN.test(request.text) && request.context.some((c) => c.kind === "diagram") ? "explain" : null;
}

/** A row of boxes, one for each label, joined by arrows, in a blank diagram. */
export function rowOfBoxes(labels: readonly string[]): string {
  const boxes = labels.map((label, i) => `<mxCell id="n${i}" value="${escape(label)}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="${40 + i * 170}" y="60" width="130" height="50" as="geometry"/></mxCell>`);
  const arrows = labels.slice(1).map((_, i) => `<mxCell id="e${i}" style="endArrow=classic;html=1;" edge="1" parent="1" source="n${i}" target="n${i + 1}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  return BLANK_DIAGRAM.replace("</root>", `${[...boxes, ...arrows].join("")}</root>`);
}

/** The attached page's title and the headings in it (up to five), or stand-ins when no page is attached. */
async function subject(vault: VaultClient | null, request: Pick<ChatRequest, "context">): Promise<{ title: string; labels: string[] }> {
  const chip = request.context.find((c) => c.kind === "note");
  const path = chip?.ref[0];
  if (vault && chip && path) {
    try {
      const text = (await vault.read(path)).text;
      const labels = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1]!.trim()).slice(0, 5);
      if (labels.length >= 2) return { title: `${chip.label}: overview`, labels };
    } catch {
      // Stand-ins below.
    }
  }
  return { title: chip ? `${chip.label}: overview` : "Preview diagram", labels: ["Start", "Draft", "Review", "Done"] };
}

/** What a turn is played with. */
export interface DiagramTurn {
  vault: VaultClient | null;
  request: Pick<ChatRequest, "text" | "context">;
  say(event: Omit<ChatEvent, "chat" | "turn">): void;
  /** Streams words; false when the answer was stopped. */
  stream(text: string): Promise<boolean>;
  /** A pause as long as a tool takes. */
  pause(): Promise<void>;
  id(): string;
}

/** Plays the turn; false when the answer was stopped. */
export async function playDiagram(turn: DiagramTurn, ask: "draw" | "explain"): Promise<boolean> {
  const { vault, request, say, stream, pause } = turn;
  if (ask === "explain") {
    const path = request.context.find((c) => c.kind === "diagram")?.ref[0] ?? "";
    let text: string;
    try {
      if (!vault) throw new Error("no vault is open");
      const xml = (await vault.diagram(path)).xml;
      const boxes = (xml.match(/vertex="1"/g) ?? []).length;
      const arrows = (xml.match(/edge="1"/g) ?? []).length;
      text = `It holds ${count(boxes, "box", "boxes")} and ${count(arrows, "arrow")}. A real model would walk through them in order, name what looks missing, and leave the diagram as it is.`;
    } catch (err) {
      text = `The diagram could not be read: ${message(err)}.`;
    }
    return stream(INTRO + text);
  }
  if (!(await stream(INTRO + "I'll draw it with the diagram tools.\n\n"))) return false;
  const { title, labels } = await subject(vault, request);
  const id = turn.id();
  say({ kind: "tool", tool: { id, name: "diagram_new", input: { title, spec: { nodes: labels.map((label, i) => ({ id: `n${i}`, label })) } } } });
  await pause();
  try {
    if (!vault) throw new Error("no vault is open");
    const path = await vault.createDiagram(title, null, rowOfBoxes(labels));
    say({ kind: "toolResult", result: { id, ok: true, summary: `Made the diagram “${title}” with ${count(labels.length * 2 - 1, "cell")} · lint: 0 errors, 0 warnings`, paths: [path] } });
    return stream(`\n\n“${title}” is in the Diagrams view now: ${count(labels.length, "box", "boxes")}, one for each heading. Open it from the row above.`);
  } catch (err) {
    say({ kind: "toolResult", result: { id, ok: false, summary: `Could not make the diagram “${title}”: ${message(err)}`, paths: [] } });
    return stream("\n\nThe diagram could not be made.");
  }
}
