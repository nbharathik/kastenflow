import { describe, expect, it, vi } from "vitest";

import { showScreen } from "./screen.ts";

/** A host whose full screen answers when told to, so the moment between asking and the answer can be tested. */
function slowHost() {
  const answers: (() => void)[] = [];
  const give = vi.fn();
  const lefts: (() => void)[] = [];
  const fill = vi.fn(
    (onLeft: () => void) =>
      new Promise<() => void>((resolve) => {
        lefts.push(onLeft);
        answers.push(() => resolve(give));
      }),
  );
  return { fill, give, answer: () => answers.shift()?.(), lefts };
}

describe("the screen a show fills", () => {
  it("has none where the host has no full screen", () => {
    expect(showScreen(undefined, () => {})).toBeNull();
  });

  it("is asked for once, however often, and given back once", async () => {
    const give = vi.fn();
    const fill = vi.fn(async () => give);
    const screen = showScreen(fill, () => {})!;
    await screen.enter();
    await screen.enter();
    expect(fill).toHaveBeenCalledTimes(1);
    screen.release();
    screen.release();
    expect(give).toHaveBeenCalledTimes(1);
  });

  it("is given back at once when the show ended before the host answered", async () => {
    const host = slowHost();
    const screen = showScreen(host.fill, () => {})!;
    const entering = screen.enter();
    screen.release();
    host.answer();
    await entering;
    expect(host.give).toHaveBeenCalledTimes(1);
  });

  it("is taken again by the F key after it was given back", async () => {
    const give = vi.fn();
    const fill = vi.fn(async () => give);
    const screen = showScreen(fill, () => {})!;
    await screen.enter();
    screen.toggle();
    expect(give).toHaveBeenCalledTimes(1);
    screen.toggle();
    await Promise.resolve();
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it("ends the show when the person leaves full screen another way, and gives nothing back twice", async () => {
    const host = slowHost();
    const left = vi.fn();
    const screen = showScreen(host.fill, left)!;
    const entering = screen.enter();
    host.answer();
    await entering;
    host.lefts[0]?.();
    expect(left).toHaveBeenCalledTimes(1);
    screen.release();
    expect(host.give).not.toHaveBeenCalled();
  });

  it("does not end the show when the F key gave the screen back", async () => {
    const left = vi.fn();
    // A host whose way of giving the screen back also tells that it was left.
    const screen = showScreen(async (onLeft) => () => onLeft(), left)!;
    await screen.enter();
    screen.release();
    expect(left).not.toHaveBeenCalled();
  });

  it("looks right when the host throws, or answers with nothing", async () => {
    const throwing = showScreen(() => {
      throw new Error("no window");
    }, () => {})!;
    await expect(throwing.enter()).resolves.toBeUndefined();
    const silent = showScreen((() => undefined) as never, () => {})!;
    await expect(silent.enter()).resolves.toBeUndefined();
    expect(() => silent.release()).not.toThrow();
  });

  it("looks right without it when the host refuses", async () => {
    const fill = vi.fn(async () => {
      throw new Error("refused");
    });
    const screen = showScreen(fill, () => {})!;
    await expect(screen.enter()).resolves.toBeUndefined();
    expect(() => screen.release()).not.toThrow();
  });
});
