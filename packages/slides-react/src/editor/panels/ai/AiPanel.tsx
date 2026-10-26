import { type JSX, useMemo } from "react";

import { pendingIn } from "../../agent/marks.ts";
import { slideTitle } from "../../dialogs/slide-title.ts";
import type { AiPanelProps } from "../../host.ts";
import type { EditorSession } from "../../session/session.ts";
import type { EditorUi } from "../../ui-state.ts";
import { useEditor } from "../../useEditor.ts";
import { Icon } from "../../ui/Icon.tsx";
import { useAiStatus } from "./useAiStatus.ts";

/** The assistant tab: the host's own panel, told where the person is in the deck; or a quiet note that there is none here. */
export function AiPanel({ session }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const state = useEditor(session);
  const Panel = session.host.aiPanel;
  const { deck, slideId, selection } = state;
  const status = useAiStatus(session.host);
  const props = useMemo((): AiPanelProps | null => {
    const at = deck.slides.findIndex((s) => s.id === slideId);
    const slide = deck.slides[at];
    if (!slide) return null;
    return {
      status,
      deckPath: session.host.deckPath,
      deckTitle: deck.title,
      theme: deck.theme.name,
      slideId,
      slideNumber: at + 1,
      slideCount: deck.slides.length,
      slideTitle: slideTitle(slide),
      elementIds: selection,
      pending: pendingIn(deck),
      acceptAll: () => void session.marks.acceptAll(),
    };
  }, [session, deck, slideId, selection, status]);
  if (Panel && props) return <Panel {...props} />;
  return (
    <div className="ks-sp-empty">
      <span className="ks-sp-empty-icon" aria-hidden="true">
        <Icon name="sparkles" size={20} />
      </span>
      <h3>Assistant</h3>
      <p>Available in KastenFlow.</p>
    </div>
  );
}
