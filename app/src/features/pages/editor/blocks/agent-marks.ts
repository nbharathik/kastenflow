// Agent marks in the page editor: the blocks
// an agent wrote get a coloured margin, and the first block of each mark a
// badge naming the agent, which opens what can be done about it. The core
// marks lines; the page gives the editor its blocks as loaded and the marks,
// and a block the person edits loses its mark at once.

import type { Ctx } from "@milkdown/kit/ctx";
import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $ctx, $prose } from "@milkdown/kit/utils";

import type { AgentMark } from "../../../../lib/vault/types";
import { markedBlocks, type LoadedBlock } from "../../markdown/marked-blocks";
import { topLevel } from "../milkdown-codec";
import { agentBadge } from "./agent-badge";

/** What the badge's buttons do; the page view provides them. */
export interface AgentActions {
  /** Keeps the agent's writing on this page as it stands. */
  accept(): Promise<void>;
  /** Undoes a whole agent session, once the person has confirmed. */
  undo(session: string): Promise<void>;
  /** Shows the session in the History view. */
  history(session: string): void;
}

const NOTHING: AgentActions = { accept: async () => {}, undo: async () => {}, history: () => {} };

export const agentActionsCtx = $ctx<AgentActions, "kastenAgent">(NOTHING, "kastenAgent");

function actionsOf(ctx: Ctx): AgentActions {
  try {
    return ctx.get(agentActionsCtx.key);
  } catch {
    return NOTHING;
  }
}

interface MarksState {
  blocks: readonly LoadedBlock<Node>[];
  marks: readonly AgentMark[];
  decorations: DecorationSet;
}

type Change = Partial<Pick<MarksState, "blocks" | "marks">>;

const key = new PluginKey<MarksState>("KASTEN_AGENT_MARKS");

function decorate(ctx: Ctx, doc: Node, { blocks, marks }: Change): DecorationSet {
  if (!blocks?.length || !marks?.length) return DecorationSet.empty;
  const nodes = topLevel(doc);
  const found = markedBlocks(blocks, marks, nodes, (a, b) => a.eq(b));
  if (found.length === 0) return DecorationSet.empty;
  const starts: number[] = [];
  let pos = 0;
  for (const node of nodes) {
    starts.push(pos);
    pos += node.nodeSize;
  }
  const decorations: Decoration[] = [];
  const midnight = new Date().setHours(0, 0, 0, 0);
  for (const { from, to, badge, time } of found) {
    // Writing from today also gets the optional tint (agent.css, shown when the page menu turns it on).
    const block = time >= midnight ? "kasten-agent-block kasten-agent-today" : "kasten-agent-block";
    for (let i = from; i < to; i++) {
      decorations.push(Decoration.node(starts[i]!, starts[i]! + nodes[i]!.nodeSize, { class: block }));
    }
    if (badge) {
      const toDom = () => agentBadge(badge, () => actionsOf(ctx));
      const spec = { side: -1, key: `agent:${badge.commit}:${badge.start}`, ignoreSelection: true, stopEvent: () => true };
      decorations.push(Decoration.widget(starts[from]!, toDom, spec));
    }
  }
  return DecorationSet.create(doc, decorations);
}

export const agentMarks = $prose(
  (ctx) =>
    new Plugin<MarksState>({
      key,
      state: {
        init: () => ({ blocks: [], marks: [], decorations: DecorationSet.empty }),
        apply(tr, value, _old, state) {
          const change = tr.getMeta(key) as Change | undefined;
          if (!change && !tr.docChanged) return value;
          const next = { ...value, ...change };
          return { ...next, decorations: decorate(ctx, state.doc, next) };
        },
      },
      props: {
        decorations: (state) => key.getState(state)?.decorations,
      },
    }),
);

/** Gives the editor the page's blocks as loaded, or the marks to show. */
export function setAgentMarks(view: EditorView, change: Change): void {
  view.dispatch(view.state.tr.setMeta(key, change).setMeta("addToHistory", false));
}
