// The count of problems in the title bar: there when the deck has some, in the colour of the worst, following the deck as it changes
// (by the person or by anyone else), and opening the list.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { LintCount, countProblems } from "./LintCount.tsx";
import { lintOf } from "./service.ts";
import { offEdge } from "./test-kit.ts";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

/** A finished cover and a blank slide, in a session. */
async function openDeck() {
  const engine = await newDeck("Lint");
  const cover = engine.deck.slides[0]!;
  engine.apply("set_text", { slide: cover.id, id: cover.elements.find((e) => e.placeholder === "subtitle")!.id, markdown: "A subtitle" });
  engine.apply("add_slide", { layout: "blank" });
  const session = new EditorSession(engine, new MemoryHost(), { saveDelay: 60_000 });
  return { session, ui: new EditorUi(), blank: session.deck.slides[1]!.id };
}

const pill = () => screen.queryByRole("button", { name: /in this deck/ });

describe("the count of problems", () => {
  it("is not there while the deck has none, and the service works in the background for as long as it is on the screen", async () => {
    const { session, ui } = await openDeck();
    const view = render(<LintCount session={session} ui={ui} />);
    const lint = lintOf(session);
    expect(lint.background).toBe(true);
    await act(async () => void (await lint.checkAll()));
    expect(pill()).toBeNull();
    view.unmount();
    expect(lint.background).toBe(false);
    lint.dispose();
  });

  it("appears with the number of errors, in the colour of an error, and says them in words", async () => {
    const { session, ui, blank } = await openDeck();
    session.run(() => session.core.apply("add_elements", { slide: blank, elements: [offEdge("wide")] }));
    render(<LintCount session={session} ui={ui} />);
    await waitFor(() => expect(pill()).not.toBeNull(), { timeout: 5000 });
    const found = pill()!;
    expect(found.textContent).toBe("1");
    expect(found.className).toContain("is-error");
    expect(found.getAttribute("aria-label")).toBe("1 error in this deck. Show the list");
    lintOf(session).dispose();
  });

  it("opens the list of problems", async () => {
    const { session, ui, blank } = await openDeck();
    session.run(() => session.core.apply("add_elements", { slide: blank, elements: [offEdge("wide")] }));
    render(<LintCount session={session} ui={ui} />);
    await waitFor(() => expect(pill()).not.toBeNull(), { timeout: 5000 });
    fireEvent.click(pill()!);
    expect(ui.state.dialog).toBe("lint");
    lintOf(session).dispose();
  });

  it("follows the deck as it changes: a problem made by an edit shows, and mending it takes the count away", async () => {
    const { session, ui, blank } = await openDeck();
    render(<LintCount session={session} ui={ui} />);
    await act(async () => void (await lintOf(session).checkAll()));
    expect(pill()).toBeNull();
    // Whoever makes the change (a person, the assistant, an import) makes it through the session.
    act(() => session.goTo(blank));
    const [wide] = session.elements.insert([offEdge()]) as [string];
    await waitFor(() => expect(pill()?.textContent).toBe("1"), { timeout: 5000 });
    act(() => session.elements.remove([wide]));
    await waitFor(() => expect(pill()).toBeNull(), { timeout: 5000 });
    lintOf(session).dispose();
  });
});

describe("the service held by several views", () => {
  it("works in the background while any view wants it, and lets go when the last has, each view once", async () => {
    const { session } = await openDeck();
    const lint = lintOf(session);
    const first = lint.retain();
    const second = lint.retain();
    first();
    first();
    expect(lint.background).toBe(true);
    second();
    expect(lint.background).toBe(false);
    lint.dispose();
  });
});

describe("counting", () => {
  it("counts errors and warnings and leaves out what is only worth a look", () => {
    const issue = (severity: "error" | "warning" | "info") => ({ rule: "r", severity, message: "m", element: null }) as never;
    const counts = countProblems(new Map([["a", [issue("error"), issue("info")]], ["b", [issue("warning"), issue("warning")]]]));
    expect(counts).toEqual({ error: 1, warning: 2 });
  });
});
