import { useMemo, useSyncExternalStore } from "react";

import { Icon } from "../../ui/Icon";
import { howFrom, useWorkspace } from "../workspace/store";
import { deckAiSource } from "./ai-status";
import { continueDeck, deckToContinue } from "./return-to-slides";
import { deckTitle, useDecks } from "./store";

const SAYS = { working: "The assistant is working on it", paused: "The assistant paused and can go on", failed: "The assistant's last request failed", idle: "" } as const;

/** "Continue: <deck>" at the top of the Slides home: the deck open in a tab, else the one opened last. One click goes back to it. */
export function ContinueRow() {
  const layout = useWorkspace((s) => s.layout);
  const recent = useWorkspace((s) => s.recent);
  const list = useDecks((s) => s.list);
  const target = useMemo(() => deckToContinue(), [layout, recent, list]);
  const source = useMemo(() => deckAiSource(target?.path ?? ""), [target?.path]);
  const status = useSyncExternalStore(source.subscribe, source.current);
  if (!target) return null;
  const title = deckTitle(list, target.path);
  const says = SAYS[status];
  return (
    <button
      type="button"
      aria-label={`Continue: ${title}`}
      onClick={(event) => continueDeck(target.path, howFrom(event))}
      className="mt-6 flex w-full items-center gap-3 rounded-xl border border-line bg-canvas px-4 py-3 text-left shadow-card transition ease-standard hover:border-line-hover hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none"
    >
      <Icon name="present" className="size-5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-14 font-semibold">Continue: {title}</span>
        <span className="block truncate text-12 text-muted">{target.open ? "Open in a tab" : "Opened last"}{says ? ` · ${says}` : ""}</span>
      </span>
      <Icon name="chevron" className="size-4 shrink-0 text-muted" />
    </button>
  );
}
