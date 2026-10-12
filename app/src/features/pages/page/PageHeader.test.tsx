import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PageHeader } from "./PageHeader";
import { atQuery, withoutAt } from "./title-date";

afterEach(cleanup);

const header = (icon: string) => render(<PageHeader meta={{ title: "Plans", icon, cover: "" }} onChange={() => {}} onEnterBody={() => {}} />);

describe("PageHeader", () => {
  it("draws one of the app's line icons, not its name", () => {
    header("icon:project");
    const button = screen.getByRole("button", { name: "Change icon" });
    expect(button.querySelector("svg")).toBeTruthy();
    expect(button.textContent).toBe("");
  });

  it("shows an emoji as it is", () => {
    header("🌱");
    expect(screen.getByRole("button", { name: "Change icon" }).textContent).toBe("🌱");
  });
});

describe("atQuery", () => {
  it("reads the @ being typed before the caret", () => {
    expect(atQuery("Plan @fri", 9)).toEqual({ from: 5, query: "fri" });
    expect(atQuery("@", 1)).toEqual({ from: 0, query: "" });
    expect(atQuery("Plan @next fri 3pm", 18)).toEqual({ from: 5, query: "next fri 3pm" });
    // The caret in the middle: only what is before it counts.
    expect(atQuery("Plan @friday", 8)).toEqual({ from: 5, query: "fr" });
  });

  it("leaves out an @ inside a word, and a long or spaced-out query", () => {
    expect(atQuery("mail me@host", 12)).toBeNull();
    expect(atQuery("Plan", 4)).toBeNull();
    expect(atQuery("Plan @  x", 9)).toBeNull();
    expect(atQuery(`Plan @${"x".repeat(70)}`, 76)).toBeNull();
  });

  it("takes the typed @ out of the title", () => {
    expect(withoutAt("Plan @fri", 5, 9)).toBe("Plan");
    expect(withoutAt("@tomorrow Plan the trip", 0, 9)).toBe("Plan the trip");
    expect(withoutAt("Plan @fri trip", 5, 9)).toBe("Plan trip");
  });
});

/** A header whose title the test types into, as the page keeps it. */
function Titled({ onDate, date }: { onDate?: (day: string | null) => void; date?: string | null }) {
  const [title, setTitle] = useState("");
  return <PageHeader meta={{ title, icon: "", cover: "" }} onChange={(_key, value) => setTitle(value ?? "")} onEnterBody={() => {}} onDate={onDate} date={date} weekStart={() => 1} />;
}
const field = () => screen.getByRole("textbox", { name: "Page title" }) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const keys = () => [...document.querySelectorAll<HTMLElement>(".kasten-menu-item")].map((row) => row.dataset.key);

describe("a date from the title", () => {
  // Wednesday 7 October 2026: only the clock is faked.
  beforeEach(() => void vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 7, 10, 30) }));
  afterEach(() => void vi.useRealTimers());

  it("opens the date menu on @ and sets the page's date, taking the typed words out of the title", () => {
    const onDate = vi.fn();
    render(<Titled onDate={onDate} />);
    type("Plan @fri");
    expect(document.querySelector(".kasten-menu")?.getAttribute("aria-label")).toBe("Date");
    expect(keys()).toEqual(["day:2026-10-09"]);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onDate).toHaveBeenCalledWith("2026-10-09");
    expect(field().value).toBe("Plan");
    expect(document.querySelector(".kasten-menu")).toBeNull();
  });

  it("offers today, tomorrow and yesterday for a bare @, and picks with the mouse", () => {
    const onDate = vi.fn();
    render(<Titled onDate={onDate} />);
    type("@");
    expect(keys()).toEqual(["day:2026-10-07", "day:2026-10-08", "day:2026-10-06"]);
    fireEvent.click(document.querySelector<HTMLElement>('[data-key="day:2026-10-08"]')!);
    expect(onDate).toHaveBeenCalledWith("2026-10-08");
  });

  it("sets only the day when a time is typed, and moves with the arrow keys", () => {
    const onDate = vi.fn();
    render(<Titled onDate={onDate} />);
    type("@tom");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    type("@next fri 3pm");
    expect(keys()).toEqual(["day:2026-10-16"]);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onDate).toHaveBeenCalledWith("2026-10-16");
  });

  it("closes with Esc and on leaving the title, leaving the words", () => {
    render(<Titled onDate={vi.fn()} />);
    type("Plan @fri");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(document.querySelector(".kasten-menu")).toBeNull();
    expect(field().value).toBe("Plan @fri");
    type("Plan @fr");
    expect(document.querySelector(".kasten-menu")).not.toBeNull();
    fireEvent.blur(field());
    expect(document.querySelector(".kasten-menu")).toBeNull();
  });

  it("leaves Enter to the title when no date fits", () => {
    const onDate = vi.fn();
    render(<Titled onDate={onDate} />);
    type("Plan @zzz");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(document.querySelector(".kasten-menu")).toBeNull();
    expect(onDate).not.toHaveBeenCalled();
  });

  it("has no @ menu without a way to set the date", () => {
    render(<Titled />);
    type("Plan @fri");
    expect(document.querySelector(".kasten-menu")).toBeNull();
  });

  it("shows the date as a chip beside the title, which clears it", () => {
    const onDate = vi.fn();
    render(<Titled onDate={onDate} date="2026-10-09" />);
    const chip = screen.getByRole("group", { name: /Date: .*2026/ });
    expect(chip.textContent).toContain("Oct");
    fireEvent.click(screen.getByRole("button", { name: "Remove date" }));
    expect(onDate).toHaveBeenCalledWith(null);
  });

  it("shows no chip for a page with no date", () => {
    render(<Titled onDate={vi.fn()} />);
    expect(screen.queryByRole("group", { name: /^Date:/ })).toBeNull();
  });
});
