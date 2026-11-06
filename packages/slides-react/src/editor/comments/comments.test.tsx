import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { shape } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { newDeck } from "../../test/engine.ts";
import { CommentMarkers } from "./CommentMarkers.tsx";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { usePinning } from "./pinning.ts";

afterEach(cleanup);

async function setup() {
  localStorage.clear();
  const host = new MemoryHost();
  host.author = "Ana";
  const errors: string[] = [];
  const session = new EditorSession(await newDeck("Comments", "Light"), host, { saveDelay: 60_000, onError: (m) => errors.push(m) });
  const ui = new EditorUi();
  let ids: string[] = [];
  act(() => {
    session.slides.add({ layout: "blank" });
    ids = session.elements.insert([shape("rect", { x: 100, y: 100, w: 200, h: 100 })]);
  });
  return { session, ui, host, errors, ids };
}

describe("comments on the session", () => {
  it("are left on the slide, on an element and at a point, each signed and dated, each one step of undo", async () => {
    const { session, ids } = await setup();
    const slide = session.slide.id;
    const start = session.core.save();
    let whole: string | undefined;
    let onElement: string | undefined;
    let atPoint: string | undefined;
    act(() => {
      whole = session.review.add("  Rework this  ");
      onElement = session.review.add("Is this the right shape?", { element: ids[0] });
      atPoint = session.review.add("Move left", { pin: { x: 40, y: 80 } });
    });
    const made = session.review.of(slide);
    expect(made.map((c) => c.id)).toEqual([whole, onElement, atPoint]);
    expect(made[0]).toMatchObject({ text: "Rework this", author: "Ana" });
    expect(made[0]?.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(made[1]?.element).toBe(ids[0]);
    expect(made[2]?.pin).toEqual({ x: 40, y: 80 });
    expect(session.review.open).toBe(3);

    act(() => session.undo());
    expect(session.review.of(slide)).toHaveLength(2);
    act(() => session.undo());
    act(() => session.undo());
    expect(session.review.of(slide)).toHaveLength(0);
    expect(session.core.save()).toBe(start);
  });

  it("are answered, resolved and opened again, and words that are only spaces make nothing", async () => {
    const { session } = await setup();
    let id: string | undefined;
    act(() => {
      id = session.review.add("Check the number");
    });
    expect(session.review.add("   ")).toBeUndefined();
    expect(session.review.reply(id!, "  ")).toBe(false);
    act(() => void session.review.reply(id!, "Checked"));
    act(() => session.review.resolve(id!));
    const comment = session.review.all()[0]!.comment;
    expect(comment.resolved).toBe(true);
    expect(comment.replies?.[0]).toMatchObject({ text: "Checked", author: "Ana" });
    expect(session.review.open).toBe(0);
    act(() => session.review.resolve(id!, false));
    expect(session.review.open).toBe(1);
  });

  it("are kept in the deck's file", async () => {
    const { session } = await setup();
    act(() => void session.review.add("Hello"));
    expect(session.core.save()).toContain('"comments"');
  });
});

describe("the Comments tab", () => {
  it("says there are none, and takes a comment with the button or Ctrl+Enter", async () => {
    const { session, ui } = await setup();
    render(<CommentsPanel session={session} ui={ui} />);
    expect(screen.getByText("No comments yet")).toBeTruthy();
    const box = screen.getByRole("textbox", { name: "Comment" });
    fireEvent.change(box, { target: { value: "First" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(screen.getByText("First")).toBeTruthy();
    fireEvent.change(box, { target: { value: "Second" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(session.review.of(session.slide.id).map((c) => c.text)).toEqual(["First", "Second"]);
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("pins a comment to the selected element when asked", async () => {
    const { session, ui, ids } = await setup();
    act(() => session.select(ids));
    render(<CommentsPanel session={session} ui={ui} />);
    fireEvent.click(screen.getByRole("button", { name: "Selected element" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), { target: { value: "About the box" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(session.review.of(session.slide.id)[0]?.element).toBe(ids[0]);
  });

  it("answers and resolves from the card, and shows resolved ones only when asked", async () => {
    const { session, ui } = await setup();
    act(() => void session.review.add("Needs a source"));
    render(<CommentsPanel session={session} ui={ui} />);
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    const field = screen.getByRole("textbox", { name: "Your answer" });
    fireEvent.change(field, { target: { value: "Added one" } });
    fireEvent.click(within(field.parentElement!).getByRole("button", { name: "Answer" }));
    expect(screen.getByText("Added one")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    expect(screen.queryByText("Needs a source")).toBeNull();
    expect(screen.getByText("No open comments.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Show resolved/ }));
    expect(screen.getByText("Needs a source")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(session.review.open).toBe(1);
  });

  it("goes to the slide and selects the element a comment is about", async () => {
    const { session, ui, ids } = await setup();
    const first = session.deck.slides[0]!.id;
    act(() => void session.review.add("About the box", { element: ids[0] }));
    act(() => session.goTo(first));
    render(<CommentsPanel session={session} ui={ui} />);
    fireEvent.click(screen.getByRole("button", { name: "All slides" }));
    fireEvent.click(screen.getByRole("button", { name: /Show on slide 2/ }));
    expect(session.state.slideId).toBe(session.deck.slides[1]!.id);
    expect(session.state.selection).toEqual(ids);
  });
});

describe("the markers on the slide", () => {
  it("number the open comments of the slide shown, and none for settled ones", async () => {
    const { session, ui, ids } = await setup();
    let settled: string | undefined;
    act(() => {
      void session.review.add("On the box", { element: ids[0] });
      settled = session.review.add("Done already");
      void session.review.add("Here", { pin: { x: 10, y: 10 } });
      session.review.resolve(settled!);
    });
    render(<CommentMarkers session={session} ui={ui} zoom={1} />);
    const markers = [...document.querySelectorAll<HTMLElement>("[data-comment-marker]")];
    expect(markers.map((m) => m.textContent)).toEqual(["1", "2"]);
    expect(markers[0]?.style.left).toBe("289px");
    expect(markers[1]?.style.left).toBe("0px");
  });

  it("open the Comments tab at their comment when pressed", async () => {
    const { session, ui } = await setup();
    act(() => void session.review.add("Look here", { pin: { x: 50, y: 50 } }));
    render(<CommentMarkers session={session} ui={ui} zoom={1} />);
    fireEvent.click(document.querySelector<HTMLElement>("[data-comment-marker]")!);
    expect(ui.state.panel).toBe("comments");
  });

  it("draw nothing while a gesture is under way, and nothing on a slide without comments", async () => {
    const { session, ui } = await setup();
    const view = render(<CommentMarkers session={session} ui={ui} zoom={1} />);
    expect(view.container.innerHTML).toBe("");
    act(() => void session.review.add("x"));
    view.rerender(<CommentMarkers session={session} ui={ui} zoom={1} hidden />);
    expect(view.container.innerHTML).toBe("");
  });

  it("pin a comment at the spot pressed after Pin to a spot…, and Escape gives up", async () => {
    const { session, ui } = await setup();
    function Both() {
      return (
        <>
          <CommentsPanel session={session} ui={ui} />
          <CommentMarkers session={session} ui={ui} zoom={2} />
          <Pinning session={session} />
        </>
      );
    }
    function Pinning({ session }: { session: EditorSession }) {
      return <output data-testid="pinning">{usePinning(session) ?? "-"}</output>;
    }
    render(<Both />);
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), { target: { value: "Pinned" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin to a spot…" }));
    expect(screen.getByTestId("pinning").textContent).toBe("Pinned");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("pinning").textContent).toBe("-");
    expect(session.review.all()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Pin to a spot…" }));
    fireEvent.click(screen.getByRole("button", { name: "Press the spot on the slide for the comment" }), { clientX: 120, clientY: 60 });
    expect(session.review.all()[0]?.comment.pin).toEqual({ x: 60, y: 30 });
    expect(screen.getByTestId("pinning").textContent).toBe("-");
  });
});
