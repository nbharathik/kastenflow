// "Looks like it belongs with …", each a click to do.

import { Icon } from "../../ui/Icon";
import { tagCard } from "./CardActions";
import type { Home } from "./suggest";

const chip = "rounded-md px-2.5 py-1 text-13 font-medium ring-1 ring-line transition-colors hover:bg-hover";

export function SuggestedHome({ home, path, onMove }: { home: Home; path: string; onMove: () => void }) {
  if (!home.project && home.tags.length === 0) return null;
  const tag = (name: string) => tagCard(path, name);
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-13" aria-label="Suggested home">
      <span className="text-muted">Looks like it belongs with</span>
      {home.project && (
        <button type="button" className={chip} title={`${home.project.count} similar notes are there`} onClick={onMove}>
          <kbd className="mr-1 rounded bg-line/70 px-1 font-sans text-11">S</kbd>
          <Icon name="move-to" className="mr-1 inline size-3.5 align-[-2px]" />
          {home.project.title}
        </button>
      )}
      {home.tags.map((name) => (
        <button key={name} type="button" className={`${chip} text-accent`} title={`Add #${name}`} onClick={() => void tag(name)}>
          #{name}
        </button>
      ))}
    </p>
  );
}
