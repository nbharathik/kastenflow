import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { applyEvent, type Thread } from "../thread";
import type { ChatEvent } from "../types";
import { ToolPictures } from "./ToolPictures";

afterEach(cleanup);

const A = "data:image/png;base64,AAAA";
const B = "data:image/png;base64,BBBB";

describe("the pictures a tool drew", () => {
  it("show nothing when there are none", () => {
    const { container, rerender } = render(<ToolPictures />);
    expect(container.childElementCount).toBe(0);
    rerender(<ToolPictures pictures={[]} />);
    expect(container.childElementCount).toBe(0);
  });

  it("are thumbnails with text for what they are", () => {
    render(<ToolPictures pictures={[A, B]} />);
    expect(screen.getByRole("list", { name: "Pictures from this step" })).toBeTruthy();
    expect(screen.getByAltText("Picture 1 drawn by this step").getAttribute("src")).toBe(A);
    expect(screen.getByAltText("Picture 2 drawn by this step").getAttribute("src")).toBe(B);
  });

  it("open larger on a click, from the keyboard too, and close again", () => {
    render(<ToolPictures pictures={[A, B]} />);
    const second = screen.getByRole("button", { name: "Show picture 2 larger" });
    expect(second.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(second);
    expect(second.getAttribute("aria-expanded")).toBe("true");
    const large = screen.getByRole("button", { name: "Close the larger picture" });
    expect(screen.getByAltText("Picture 2 drawn by this step, larger").getAttribute("src")).toBe(B);
    fireEvent.keyDown(large, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Close the larger picture" })).toBeNull();
    fireEvent.click(second);
    fireEvent.click(screen.getByRole("button", { name: "Close the larger picture" }));
    expect(second.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the pictures of a tool result in the thread", () => {
  const thread = {
    messages: [{ role: "assistant", turn: "t1", status: "streaming", parts: [{ kind: "tool", call: { id: "c1", name: "render_slide", input: null }, result: null }] }],
  } as unknown as Thread;
  const result = { id: "c1", ok: true, summary: "Drew slide 1", paths: [] };

  it("are kept on the step that drew them", () => {
    const event: ChatEvent = { chat: "c", turn: "t1", kind: "toolResult", result, pictures: [A] };
    const next = applyEvent(thread, event);
    const part = (next.messages[0] as { parts: { kind: string; pictures?: string[] }[] }).parts[0];
    expect(part?.pictures).toEqual([A]);
  });

  it("are left off a step that drew none", () => {
    const event: ChatEvent = { chat: "c", turn: "t1", kind: "toolResult", result };
    const next = applyEvent(thread, event);
    const part = (next.messages[0] as { parts: { kind: string; pictures?: string[] }[] }).parts[0];
    expect(part?.pictures).toBeUndefined();
  });
});
