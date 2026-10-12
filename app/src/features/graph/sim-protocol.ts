// What the layout worker does with the messages it gets: a job starts a
// layout (stopping the one before), "stop" ends it. Kept apart from the
// worker's own file, which only wires it to the thread, so it can be tested.

import { drive, layoutOf, type LayoutJob, type Tick } from "./drive";

export type SimMessage = LayoutJob | "stop";

/** Handles messages for one worker; each tick goes to `post`. */
export function serve(post: (tick: Tick) => void, schedule?: (run: () => void) => void): (message: SimMessage) => void {
  let stop = () => {};
  return (message) => {
    stop();
    stop = () => {};
    if (message === "stop") return;
    stop = drive(layoutOf(message), post, schedule);
  };
}
