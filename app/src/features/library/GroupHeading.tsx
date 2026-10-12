import { Icon } from "../../ui/Icon";
import type { Group } from "./groups";
import { kindColor } from "./kind-tile";
import { tagChipColors } from "./parts";

/** A group's head: a button that folds it, with its name, in the colour of
 * its type or tag where it has one, and how many cards it holds. */
export function GroupHeading({ group, tagColors, onFold }: { group: Group; tagColors: Record<string, string>; onFold(key: string): void }) {
  const [mode, value = ""] = [group.key.slice(0, group.key.indexOf(":")), group.key.slice(group.key.indexOf(":") + 1)];
  return (
    <button
      type="button"
      aria-expanded={!group.folded}
      onClick={() => onFold(group.key)}
      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-14 outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Icon name="chevron" className={`size-3.5 shrink-0 text-muted transition-transform ${group.folded ? "" : "rotate-90"}`} />
      {mode === "type" && <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: `var(--color-highlight-${kindColor(value)})` }} />}
      {mode === "tag" && value ? (
        <span className="max-w-[16rem] truncate rounded px-2 py-0.5 text-12 font-medium leading-[1.4]" style={tagChipColors(tagColors[value])}>
          {group.label}
        </span>
      ) : (
        <span className="truncate font-semibold text-ink">{group.label}</span>
      )}
      <span className="shrink-0 text-12 tabular-nums text-muted">{group.count.toLocaleString()}</span>
    </button>
  );
}
