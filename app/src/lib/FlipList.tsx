// A box whose keyed children (`data-flip`) slide into place when `order`
// changes: for lists that are not already inside a box of their own.

import { useRef, type ReactNode } from "react";

import { useFlip } from "./flip";

export function FlipList({ order, className, children }: { order: string; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useFlip(box, order);
  return (
    <div ref={box} className={className}>
      {children}
    </div>
  );
}
