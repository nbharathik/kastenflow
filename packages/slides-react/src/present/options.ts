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

/** Where the choice of the mouse toolbar is kept in this browser. */
export const TOOLBAR_KEY = "ks-present-toolbar";

/** Whether the mouse toolbar shows at the bottom left while presenting; on until the person turns it off. */
export function readToolbar(): boolean {
  try {
    return localStorage.getItem(TOOLBAR_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeToolbar(on: boolean): void {
  try {
    localStorage.setItem(TOOLBAR_KEY, on ? "on" : "off");
  } catch {
    // Nothing is remembered; the choice still holds for the presentation that is open.
  }
}
