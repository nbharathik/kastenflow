// A window nobody sees holds still: animations pause under data-window="hidden".

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { watchHidden } from "./motion";

function hide(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", { value: hidden ? "hidden" : "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => hide(false));

describe("watchHidden", () => {
  it("marks the page while the window is hidden and clears it when shown", () => {
    const stop = watchHidden();
    expect(document.documentElement.dataset.window).toBeUndefined();
    hide(true);
    expect(document.documentElement.dataset.window).toBe("hidden");
    hide(false);
    expect(document.documentElement.dataset.window).toBeUndefined();
    stop();
  });

  it("starts from the state the window is in, and leaves nothing behind when stopped", () => {
    hide(true);
    const stop = watchHidden();
    expect(document.documentElement.dataset.window).toBe("hidden");
    stop();
    expect(document.documentElement.dataset.window).toBeUndefined();
    hide(false);
    hide(true);
    expect(document.documentElement.dataset.window).toBeUndefined();
  });

  it("has a rule that pauses every animation under it, spinners and progress too", () => {
    const css = readFileSync(join(process.cwd(), "src", "motion.css"), "utf8");
    expect(css).toMatch(/:root\[data-window="hidden"\] \*[\s\S]*animation-play-state: paused !important/);
  });
});
