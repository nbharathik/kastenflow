// A thin row of things to open, one line high: Home's favourites and its
// projects. A few show; the rest are in a "+N" menu, so the row never wraps
// or grows.

import type { ReactNode } from "react";

import { Menu, type MenuItem } from "../../shell/Menu";
import { openMenuHandlers } from "../../shell/open-menu";
import { Icon, type IconName } from "../../ui/Icon";
import { howFrom, type OpenHow } from "../workspace/store";

export interface Chip {
  /** Where it goes: a vault path. */
  path: string;
  label: string;
  /** Its icon, drawn by the caller (an emoji or a line icon). */
  icon: ReactNode;
  /** Small text after the label, such as a count. */
  detail?: string;
  open(how: OpenHow): void;
}

interface ChipRowProps {
  /** The row's name, for screen readers and the "+N" menu. */
  label: string;
  icon: IconName;
  chips: readonly Chip[];
  /** How many show before "+N". */
  max?: number;
  /** Something at the end of the row, such as a button that adds one. */
  end?: ReactNode;
}

export function ChipRow({ label, icon, chips, max = 7, end }: ChipRowProps) {
  const shown = chips.slice(0, max);
  const more: MenuItem[] = chips.slice(max).map((chip) => ({ label: chip.label, icon: chip.icon, onSelect: () => chip.open("here") }));
  return (
    <div role="group" aria-label={label} className="kasten-home-chips">
      <Icon name={icon} className="size-[15px] shrink-0 text-faint" />
      {shown.map((chip) => (
        <button key={chip.path} type="button" className="kasten-home-chip" title={chip.label} onClick={(event) => chip.open(howFrom(event))} {...openMenuHandlers(chip.path)}>
          <span className="kasten-home-chip-icon">{chip.icon}</span>
          <span className="kasten-home-chip-label">{chip.label}</span>
          {chip.detail && <span className="kasten-home-chip-detail">{chip.detail}</span>}
        </button>
      ))}
      {more.length > 0 && (
        <Menu label={`More ${label.toLowerCase()}`} items={more} align="left" float buttonClass="kasten-home-chip is-more">
          +{more.length}
        </Menu>
      )}
      {end}
    </div>
  );
}
