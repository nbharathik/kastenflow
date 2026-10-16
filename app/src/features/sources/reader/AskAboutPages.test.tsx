import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../../lib/store";
import type { Highlight } from "../../../lib/vault/types";
import { useChat } from "../../chat/store";
import { resetChat, scriptedChat } from "../../chat/test-kit";
import { AskAboutPages } from "./AskAboutPages";

const mark = (id: string, page: number): Highlight => ({ id, page, rects: [], text: `Text on ${page}`, color: "yellow", comment: null, card: null, cardId: null, created: null }) as unknown as Highlight;
const HIGHLIGHTS = [mark("h1", 1), mark("h2", 3), mark("h3", 3), mark("h4", 12)];

beforeEach(() => {
  localStorage.clear();
  resetChat(scriptedChat());
  useShell.setState({ chatOpen: false });
});
afterEach(cleanup);

function open(current = 3) {
  render(<AskAboutPages source="sources/primer.pdf" title="A primer" current={current} pages={20} highlights={HIGHLIGHTS} />);
  fireEvent.click(screen.getByRole("button", { name: "Ask AI about these pages…" }));
  return screen.getByRole("dialog", { name: "Ask AI about these pages" });
}

describe("Ask AI about these pages", () => {
  it("starts with the page in view and the highlights on it, and opens a chat with exactly those", () => {
    const form = open(3);
    const pages = within(form).getByRole("textbox", { name: "Pages" }) as HTMLInputElement;
    expect(pages.value).toBe("3");
    expect(within(form).getByText("1 page of 20; the most is 10")).toBeTruthy();
    const marks = within(form).getByRole("checkbox", { name: "Include the 2 highlights on this page" }) as HTMLInputElement;
    expect(marks.checked).toBe(true);
    act(() => fireEvent.click(within(form).getByRole("button", { name: "Ask in chat" })));

    expect(screen.queryByRole("dialog", { name: "Ask AI about these pages" })).toBeNull();
    expect(useShell.getState().chatOpen).toBe(true);
    const thread = useChat.getState().threads[useChat.getState().active!]!;
    expect(thread.context).toEqual([{ kind: "pdf", label: "A primer · p. 3 + 2 highlights", ref: ["sources/primer.pdf", "pages:3", "highlights:h2,h3"], origin: "added" }]);
    // About these pages and not the page in front.
    expect(thread.follow).toBe(false);
  });

  it("takes a range, leaves the highlights out when asked, and counts the ones in range", () => {
    const form = open(1);
    const pages = within(form).getByRole("textbox", { name: "Pages" });
    fireEvent.change(pages, { target: { value: "1-3, 5" } });
    expect(within(form).getByText("4 pages of 20; the most is 10")).toBeTruthy();
    expect(within(form).getByRole("checkbox", { name: "Include the 3 highlights on these pages" })).toBeTruthy();
    fireEvent.click(within(form).getByRole("checkbox"));
    act(() => fireEvent.click(within(form).getByRole("button", { name: "Ask in chat" })));
    const thread = useChat.getState().threads[useChat.getState().active!]!;
    expect(thread.context[0]).toMatchObject({ label: "A primer · pp. 1-3, 5", ref: ["sources/primer.pdf", "pages:1-3,5"] });
  });

  it("says why it cannot ask: too many pages, a page the PDF has not, words that are not pages", () => {
    const form = open(1);
    const pages = within(form).getByRole("textbox", { name: "Pages" });
    const asks = () => (within(form).getByRole("button", { name: "Ask in chat" }) as HTMLButtonElement).disabled;
    for (const [typed, why] of [
      ["1-11", "Choose at most 10 pages at a time"],
      ["21", "This PDF has 20 pages"],
      ["", "Name a page, or a range such as 3-5"],
      ["4-2", "“4-2” runs backwards"],
      ["abc", "“abc” is not a page number"],
    ] as const) {
      fireEvent.change(pages, { target: { value: typed } });
      expect(within(form).getByRole("alert").textContent, typed).toBe(why);
      expect(asks(), typed).toBe(true);
    }
    // The most is fine.
    fireEvent.change(pages, { target: { value: "1-10" } });
    expect(asks()).toBe(false);
    expect(useChat.getState().order).toEqual([]);
  });

  it("closes without asking on Cancel, and has no checkbox where there are no highlights", () => {
    const form = open(7);
    expect(within(form).queryByRole("checkbox")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Ask AI about these pages" })).toBeNull();
    expect(useChat.getState().order).toEqual([]);
    expect(useShell.getState().chatOpen).toBe(false);
  });
});
