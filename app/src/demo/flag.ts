// The demo switch for the browser preview: `?demo=1.2.2` (with or without
// `?samples=dev`). It is read once and only in a browser, never in the desktop
// app. This file is all that the rest of the window loads for it; everything
// the switch turns on lives in the lazily loaded demo code (demo/index.ts).

import { inTauri } from "../lib/api";

/** The value of `?demo=` that turns the demo on. */
export const DEMO_VALUE = "1.2.2";

let forced: boolean | null = null;
let seen: boolean | null = null;

function readSwitch(): boolean {
  try {
    return !inTauri() && typeof location !== "undefined" && new URLSearchParams(location.search).get("demo") === DEMO_VALUE;
  } catch {
    return false;
  }
}

/** Whether this window is the browser preview in demo mode. */
export function inDemo(): boolean {
  if (forced !== null) return forced;
  seen ??= readSwitch();
  return seen;
}

/** Tests: answers `inDemo` as given; null reads the address again. */
export function setDemoForTests(value: boolean | null): void {
  forced = value;
  seen = null;
}
