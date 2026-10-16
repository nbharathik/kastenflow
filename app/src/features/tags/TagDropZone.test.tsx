import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NOTE_DRAG } from "../workspace/drag";
import { TagDropZone } from "./TagDropZone";

afterEach(cleanup);

/** A drag event carrying data of these types (jsdom has no DataTransfer). */
function drag(type: "dragEnter" | "dragOver" | "dragLeave" | "drop", target: Element, data: Record<string, string>) {
  const event = createEvent[type](target);
  const store = { ...data };
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: Object.keys(store),
      getData: (key: string) => store[key] ?? "",
      dropEffect: "none",
    },
  });
  fireEvent(target, event);
  return event;
}

describe("a tag's body as a place pages are dropped", () => {
  it("shows what dropping does before it is let go, and takes the pages on drop", () => {
    const onDrop = vi.fn();
    render(
      <TagDropZone tag="reading" onDrop={onDrop} className="kasten-tagdb-body">
        <p>The list</p>
      </TagDropZone>,
    );
    const zone = screen.getByText("The list").parentElement!;
    expect(zone.className).toContain("kasten-tagdb-body");
    expect(screen.queryByRole("status")).toBeNull();
    const over = drag("dragEnter", screen.getByText("The list"), { [NOTE_DRAG]: "library/a.md\nlibrary/b.md" });
    expect(screen.getByRole("status").textContent).toBe("Add tag #reading");
    const hover = drag("dragOver", zone, { [NOTE_DRAG]: "library/a.md" });
    expect(hover.defaultPrevented).toBe(true);
    expect(over).toBeTruthy();
    drag("drop", zone, { [NOTE_DRAG]: "library/a.md\nlibrary/b.md\n\n" });
    expect(onDrop).toHaveBeenCalledWith(["library/a.md", "library/b.md"]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("goes quiet when the drag leaves, even across the children it passed", () => {
    render(
      <TagDropZone tag="reading" onDrop={vi.fn()}>
        <p>One</p>
        <p>Two</p>
      </TagDropZone>,
    );
    const zone = screen.getByText("One").parentElement!;
    drag("dragEnter", zone, { [NOTE_DRAG]: "a.md" });
    drag("dragEnter", screen.getByText("One"), { [NOTE_DRAG]: "a.md" });
    drag("dragLeave", zone, { [NOTE_DRAG]: "a.md" });
    expect(screen.getByRole("status")).toBeTruthy();
    drag("dragLeave", screen.getByText("One"), { [NOTE_DRAG]: "a.md" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lets everything else through: files, text and tabs are not pages", () => {
    const onDrop = vi.fn();
    render(
      <TagDropZone tag="reading" onDrop={onDrop}>
        <p>The list</p>
      </TagDropZone>,
    );
    const zone = screen.getByText("The list").parentElement!;
    const others: Record<string, string>[] = [{ Files: "" }, { "text/plain": "hello" }, { "application/x-kasten-tab": "t1" }];
    for (const data of others) {
      const hover = drag("dragOver", zone, data);
      expect(hover.defaultPrevented).toBe(false);
      drag("dragEnter", zone, data);
      expect(screen.queryByRole("status")).toBeNull();
      drag("drop", zone, data);
    }
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("ignores a drop that carries no pages", () => {
    const onDrop = vi.fn();
    render(
      <TagDropZone tag="reading" onDrop={onDrop}>
        <p>The list</p>
      </TagDropZone>,
    );
    drag("drop", screen.getByText("The list").parentElement!, { [NOTE_DRAG]: "  \n " });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
