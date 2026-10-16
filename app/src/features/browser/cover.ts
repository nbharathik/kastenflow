// A view that fills the window and is not a tab (a presentation) covers the
// tabs too. A web link followed while one is open must not make a browser tab
// the person cannot see: it opens in the system's browser, or in the view's own
// preview. This is the one place that says whether such a view is open.

let covering = 0;

/** A view fills the window now. Returns how to say it is gone. */
export function coverWindow(): () => void {
  covering += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    covering -= 1;
  };
}

/** Whether a view that fills the window is open. */
export const windowCovered = (): boolean => covering > 0;
