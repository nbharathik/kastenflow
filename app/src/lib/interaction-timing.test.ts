import { describe, expect, it } from "vitest";

import { describeTarget, slowLine, watchInteractions } from "./interaction-timing";

describe("interaction timing (dev only)", () => {
  it("logs nothing under the limit", () => {
    expect(slowLine({ entryType: "event", name: "click", duration: 99 })).toBeNull();
  });

  it("names the event and the element when a handler is slow", () => {
    const button = document.createElement("button");
    button.setAttribute("aria-label", "Send");
    expect(slowLine({ entryType: "event", name: "click", duration: 140.4, target: button })).toBe("[kasten:slow-event] click on button[Send] took 140 ms");
  });

  it("logs a long task by its length", () => {
    expect(slowLine({ entryType: "longtask", name: "self", duration: 196 })).toBe("[kasten:long-task] 196 ms on the main thread");
  });

  it("describes an element by classes, and a missing one safely", () => {
    const div = document.createElement("div");
    div.className = "a b c";
    expect(describeTarget(div)).toBe("div.a.b");
    expect(describeTarget(null)).toBe("unknown element");
  });

  it("starts and stops without error where the observers are missing", () => {
    expect(() => watchInteractions(() => {})()).not.toThrow();
  });
});
