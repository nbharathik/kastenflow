// What the person chose in the slideshow options besides the colour round the slide: whether reveal.js's arrows and progress bar
// show while presenting. They are off until chosen, so a talk starts as clean as a slide in full screen.

/** Where the choice is kept in this browser. */
export const CONTROLS_KEY = "ks-present-controls";

/** Whether the arrows and the progress bar show; off until the person turns them on. */
export function readControls(): boolean {
  try {
    return localStorage.getItem(CONTROLS_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeControls(on: boolean): void {
  try {
    localStorage.setItem(CONTROLS_KEY, on ? "on" : "off");
  } catch {
    // Nothing is remembered; the choice still holds for the presentation that is open.
  }
}
