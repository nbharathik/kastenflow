// An IntersectionObserver for the tests: nothing is in view until a test says
// so, for every element or for one element and what is inside it.

import { act } from "@testing-library/react";

export class FakeObserver {
  static all: FakeObserver[] = [];
  private element: Element | null = null;
  constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    FakeObserver.all.push(this);
  }
  observe(element: Element) {
    this.element = element;
  }
  disconnect() {
    FakeObserver.all = FakeObserver.all.filter((o) => o !== this);
  }
  /** Tells every observer, or those watching `only` or something inside it, whether their element is in view. */
  static show(isIntersecting: boolean, only?: Element) {
    act(() =>
      FakeObserver.all
        .filter((o) => !only || (o.element !== null && only.contains(o.element)))
        .forEach((o) => o.callback([{ isIntersecting }])),
    );
  }
  static reset() {
    FakeObserver.all = [];
  }
}
