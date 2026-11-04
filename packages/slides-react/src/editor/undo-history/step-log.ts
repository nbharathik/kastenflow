// The steps of undo as a list a person can read: what each step was called, and where in the list the deck stands. The engine only
// says what the next undo and redo would take back, so the editor keeps this list beside it, told about every change as it happens.
// It starts empty when the deck is opened (steps from before are not known), and it follows the engine's own rules: a new change
// drops what could have been redone, undo and redo only move along the list.

import { stepName } from "../menus/history-label.ts";

/** One step of undo. */
export interface LoggedStep {
  /** Counts from 1 for as long as the editor lives; names a row. */
  id: number;
  /** The engine's name for it (`transform_elements`). */
  operation: string;
  /** What a person calls it ("Move elements"). */
  label: string;
}

/** A place in the list as a row shows it: the state after `position` steps. Position 0 is the deck as it was opened. */
export interface HistoryRow {
  position: number;
  label: string;
  /** The deck is here now. */
  current: boolean;
  /** Undone: it would come back with Redo. */
  undone: boolean;
}

/** How many steps the list keeps; the engine keeps a limited history too. */
export const MOST_STEPS = 200;

export class StepLog {
  private steps: LoggedStep[] = [];
  private done = 0;
  private counter = 0;

  /** Steps that are done now; the deck stands after this many. */
  get position(): number {
    return this.done;
  }

  get length(): number {
    return this.steps.length;
  }

  /**
   * The engine changed. `replay` says whether it was an undo or a redo; otherwise a change of `operation` was made, unless it
   * changed nothing (the engine keeps no step for that).
   */
  note(replay: "undo" | "redo" | null, operation: string | undefined, empty = false): void {
    if (replay === "undo") {
      this.done = Math.max(0, this.done - 1);
      return;
    }
    if (replay === "redo") {
      this.done = Math.min(this.steps.length, this.done + 1);
      return;
    }
    if (empty || !operation) return;
    this.steps.length = this.done;
    this.counter += 1;
    this.steps.push({ id: this.counter, operation, label: stepName(operation) ?? operation });
    if (this.steps.length > MOST_STEPS) this.steps.shift();
    this.done = this.steps.length;
  }

  /** The deck was replaced by a version from outside: the list no longer says anything about it. */
  reset(): void {
    this.steps = [];
    this.done = 0;
  }

  /** The rows, newest first: the steps that were undone on top, then the one the deck stands on, then the steps before it. */
  rows(): HistoryRow[] {
    const rows: HistoryRow[] = [];
    for (let position = this.steps.length; position >= 1; position--) {
      rows.push({ position, label: this.steps[position - 1]?.label ?? "", current: position === this.done, undone: position > this.done });
    }
    rows.push({ position: 0, label: "Opened", current: this.done === 0, undone: false });
    return rows;
  }

  /** How far to go to stand after `position` steps: negative is that many undos, positive that many redos. */
  distanceTo(position: number): number {
    return Math.min(Math.max(position, 0), this.steps.length) - this.done;
  }
}

/** What goes back and forth through the engine: undo or redo, one step at a time, so the list follows. */
export interface Stepper {
  undo(): void;
  redo(): void;
}

/** Stands the deck after `position` steps by undoing or redoing; answers how many steps it took. */
export function jumpTo(log: StepLog, stepper: Stepper, position: number): number {
  const distance = log.distanceTo(position);
  const move = distance < 0 ? () => stepper.undo() : () => stepper.redo();
  for (let n = 0; n < Math.abs(distance); n++) move();
  return Math.abs(distance);
}
