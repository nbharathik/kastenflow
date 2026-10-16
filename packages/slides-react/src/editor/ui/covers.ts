// Whether something of the editor's own (a dialog, a menu, a popover) is open over the page. A web view that a host draws natively
// sits above everything the page draws, so while one of these is open the view has to be taken off the screen (`hide`) and put back
// when the last one goes. Dialogs and popovers say so here as they open and close; the web preview listens.

let open = 0;
const listeners = new Set<() => void>();

const changed = (): void => {
  for (const listener of [...listeners]) listener();
};

/** Something is open over the page. Returns how to say it is gone. */
export function holdCover(): () => void {
  open += 1;
  changed();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    open -= 1;
    changed();
  };
}

/** Whether anything is open over the page now. */
export const covered = (): boolean => open > 0;

/** Calls `listener` when something opens or the last thing closes. Returns how to stop. */
export function onCoverChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
