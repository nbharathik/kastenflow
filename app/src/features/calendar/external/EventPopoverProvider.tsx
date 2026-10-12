// One event popover for a whole Calendar. A chip in a day's "+N more" list
// lives in a popup of its own, which closes on a click outside it and would
// take the chip's own popover with it; held here, the details outlast it.

import { createContext, useCallback, useContext, useState, type ReactNode, type RefObject } from "react";

import { swatch } from "../../panel/properties/schemas";
import { toneStyle } from "../actions";
import { EventPopover } from "./EventPopover";
import type { Box } from "./place";
import { useFeeds } from "./store";
import type { EventPart } from "./types";

type Show = (part: EventPart, chip: HTMLElement) => void;

const Context = createContext<Show | null>(null);

/** The way to show an event's details, when a provider is around; null otherwise. */
export const useShowEvent = (): Show | null => useContext(Context);

interface Open {
  part: EventPart;
  anchor: RefObject<HTMLElement | null>;
  /** Where the chip was when it was clicked, for when it is gone. */
  box: Box;
}

export function EventPopoverProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const calendar = useFeeds((s) => s.list?.find((c) => c.id === open?.part.event.calendar));
  const show = useCallback<Show>((part, chip) => {
    const { left, top, width, height } = chip.getBoundingClientRect();
    // A second click on the chip closes the details it opened.
    setOpen((now) => (now && now.part.key === part.key ? null : { part, anchor: { current: chip }, box: { left, top, width, height } }));
  }, []);
  return (
    <Context.Provider value={show}>
      {children}
      {open && <EventPopover key={open.part.key} part={open.part} calendar={calendar} anchor={open.anchor} box={open.box} tone={toneStyle(swatch(calendar?.color))} onClose={() => setOpen(null)} />}
    </Context.Provider>
  );
}
