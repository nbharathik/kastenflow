import { Activity, useRef, type ReactNode } from "react";

import { keptIds, touch } from "./keep-alive";

interface KeepAliveProps<T extends { id: string }> {
  /** The pane's tabs, in their order. */
  items: readonly T[];
  /** The tab shown. */
  active: string;
  /** How many other recent tabs stay ready (0 keeps none). */
  keep: number;
  /** Whether a tab may stay ready while hidden; a browser tab may not. */
  canKeep: (item: T) => boolean;
  render: (item: T, visible: boolean) => ReactNode;
}

/** Renders the shown tab and, hidden, the last few visited ones, so they keep their state. A hidden tab runs no effects (timers, listeners) until it is shown again. */
export function KeepAlive<T extends { id: string }>({ items, active, keep, canKeep, render }: KeepAliveProps<T>) {
  const order = useRef<readonly string[]>([]);
  order.current = touch(order.current, active);
  const byId = new Map(items.map((item) => [item.id, item]));
  const kept = keptIds(order.current, active, keep, (id) => {
    const item = byId.get(id);
    return item !== undefined && canKeep(item);
  });
  return (
    <>
      {items
        .filter((item) => kept.has(item.id))
        .map((item) => (
          <Activity key={item.id} mode={item.id === active ? "visible" : "hidden"}>
            {render(item, item.id === active)}
          </Activity>
        ))}
    </>
  );
}
