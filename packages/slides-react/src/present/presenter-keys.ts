// The keys of the presenter's window. They drive the show: next and back, the black screen, going to a slide by its number, ending
// the show, and the timer. (The notes' size, Ctrl + and Ctrl -, is the view's own and is passed in.)

import { useEffect, useRef, useState } from "react";

import { type Direction, type Plan, type Position, firstPosition, hasBackups, lastPosition, move, positionOf } from "./plan.ts";

/** The keys of the presenter's view: the move each stands for. */
export function moveOfKey(event: Pick<KeyboardEvent, "key" | "shiftKey">): Direction | "first" | "last" | null {
  switch (event.key) {
    case "ArrowRight":
    case "PageDown":
    case "n":
    case "N":
      return "right";
    case " ":
      return event.shiftKey ? "left" : "right";
    case "ArrowLeft":
    case "PageUp":
    case "p":
    case "P":
      return "left";
    case "ArrowDown":
      return "down";
    case "ArrowUp":
      return "up";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

export function target(plan: Plan, from: Position, key: Direction | "first" | "last"): Position {
  if (key === "first") return firstPosition();
  if (key === "last") return lastPosition(plan);
  // Up and down are for backup slides; in a deck without any they step like right and left.
  return move(plan, from, key);
}

/** The position of the slide that is number `number` among the slides shown, as it appears; null when there is none. */
export function slideNumbered(plan: Plan, number: number): Position | null {
  for (const [id, place] of plan.numbers) if (place === number) return positionOf(plan, id);
  return null;
}

/** Whether a key goes to a field the person is typing in. */
function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export interface PresenterKeys {
  plan: Plan;
  position: Position;
  paused: boolean;
  onGo(position: Position, paused?: boolean): void;
  /** Escape, with nothing typed: the show is asked to end. */
  onEnd?: (() => void) | undefined;
  /** Ctrl and plus or minus or zero. */
  onResize(by: number | "reset"): void;
  onToggleTimer(): void;
  onResetTimer(): void;
}

/** How long a number typed for a slide waits for Enter. */
const NUMBER_WAIT = 4000;

/** How long after a first Escape a second one ends the show. */
export const END_CONFIRM_MS = 2000;

/**
 * Listens for the keys; returns the number typed so far (for a line that says it), and whether a first Escape is waiting for a
 * second (the show ends on the second press within `END_CONFIRM_MS`, so one stray press does not end a talk in front of people).
 */
export function usePresenterKeys({ plan, position, paused, onGo, onEnd, onResize, onToggleTimer, onResetTimer }: PresenterKeys): { typed: string; endArmed: boolean } {
  const [typed, setTyped] = useState("");
  const [endArmed, setEndArmed] = useState(false);
  const armedNow = useRef(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typedNow = useRef("");
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = (on: boolean): void => {
    armedNow.current = on;
    setEndArmed(on);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = on ? setTimeout(() => arm(false), END_CONFIRM_MS) : null;
  };
  const armLatest = useRef(arm);
  armLatest.current = arm;

  const set = (next: string): void => {
    typedNow.current = next;
    setTyped(next);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = next === "" ? null : setTimeout(() => set(""), NUMBER_WAIT);
  };
  const latest = useRef(set);
  latest.current = set;

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      const lone = !command && !event.altKey;
      if (command && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        onResize(1);
      } else if (command && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        onResize(-1);
      } else if (command && event.key === "0") {
        event.preventDefault();
        onResize("reset");
      } else if (!lone) {
        return;
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (typedNow.current !== "") latest.current("");
        else if (!onEnd) return;
        else if (armedNow.current) {
          armLatest.current(false);
          onEnd();
        } else armLatest.current(true);
      } else if (typing(event.target)) {
        return;
      } else if (event.key.length === 1 && event.key >= "0" && event.key <= "9") {
        event.preventDefault();
        latest.current((typedNow.current + event.key).slice(0, 4));
      } else if (event.key === "Enter" && typedNow.current !== "") {
        event.preventDefault();
        const at = slideNumbered(plan, Number(typedNow.current));
        latest.current("");
        if (at) onGo(at);
      } else if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        onGo(position, !paused);
      } else if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        onToggleTimer();
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        onResetTimer();
      } else {
        const wanted = moveOfKey(event);
        if (!wanted) return;
        event.preventDefault();
        // In a deck without backup slides the arrows down and up are just as good as right and left.
        const key = !hasBackups(plan) ? (wanted === "down" ? "right" : wanted === "up" ? "left" : wanted) : wanted;
        onGo(target(plan, position, key));
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [plan, position, paused, onGo, onEnd, onResize, onToggleTimer, onResetTimer]);

  return { typed, endArmed };
}
