import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dropdown, type DropdownOption } from "./Dropdown";

afterEach(cleanup);

const FEW: DropdownOption[] = [
  { value: "", label: "Any project" },
  { value: ":inbox", label: "Inbox" },
  { value: "photo", label: "Photo organiser", group: "Projects" },
  { value: "trip", label: "Trip", group: "Projects" },
];
const MANY: DropdownOption[] = [{ value: "", label: "Any tag" }, ...Array.from({ length: 12 }, (_, i) => ({ value: `tag-${i}`, label: `#tag${i}`, detail: String(i + 1) }))];

function Pick({ options = FEW, onChange = () => {}, ...rest }: { options?: DropdownOption[]; onChange?: (value: string) => void } & Partial<Parameters<typeof Dropdown>[0]>) {
  const [value, setValue] = useState("");
  const change = (next: string) => {
    setValue(next);
    onChange(next);
  };
  return <Dropdown label="Project" value={value} options={options} onChange={change} {...rest} />;
}

describe("Dropdown", () => {
  it("shows its name and what is chosen, closed until clicked", () => {
    render(<Pick />);
    const button = screen.getByRole("button", { name: "Project: Any project" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("listbox", { name: "Project" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Any project", "Inbox", "Photo organiser", "Trip"]);
    expect(within(list).getByRole("option", { name: "Any project" }).getAttribute("aria-selected")).toBe("true");
  });

  it("chooses with a click and closes", () => {
    const onChange = vi.fn();
    render(<Pick onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Project: Any project" }));
    fireEvent.click(screen.getByRole("option", { name: "Trip" }));
    expect(onChange).toHaveBeenCalledWith("trip");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Project: Trip" })).toBeTruthy();
  });

  it("opens with the arrow keys, moves, chooses with Enter and gives the focus back", () => {
    const onChange = vi.fn();
    render(<Pick onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Project: Any project" });
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const list = screen.getByRole("listbox", { name: "Project" });
    // The list holds the focus, and the chosen option is the current one.
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Any project" }).id);
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(list.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Photo organiser" }).id);
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "Home" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(list.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Any project" }).id);
    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("trip");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Project: Trip" }));
  });

  it("closes with Esc without choosing, and keeps Esc from the page behind", () => {
    const onChange = vi.fn();
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    render(<Pick onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Project: Any project" });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    expect(behind).not.toHaveBeenCalled();
    window.removeEventListener("keydown", behind);
  });

  it("closes on a click elsewhere", () => {
    render(
      <>
        <Pick />
        <p>Elsewhere</p>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Project: Any project" }));
    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("has no box to type in for a short list", () => {
    render(<Pick />);
    fireEvent.click(screen.getByRole("button", { name: "Project: Any project" }));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("narrows a long list as you type, from the first key", () => {
    const onChange = vi.fn();
    render(<Pick label="Tag" options={MANY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Tag: Any tag" }));
    const box = screen.getByRole("textbox", { name: "Find in Tag" });
    expect(document.activeElement).toBe(box);
    expect(screen.getAllByRole("option")).toHaveLength(13);
    fireEvent.change(box, { target: { value: "tag1" } });
    // #tag1, #tag10 and #tag11, each with its count.
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["#tag12", "#tag1011", "#tag1112"]);
    fireEvent.change(box, { target: { value: "tag10" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("tag-10");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says so when nothing matches, and Enter then picks nothing", () => {
    const onChange = vi.fn();
    render(<Pick label="Tag" options={MANY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Tag: Any tag" }));
    const box = screen.getByRole("textbox", { name: "Find in Tag" });
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches")).toBeTruthy();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("can find an option by its count", () => {
    render(<Pick label="Tag" options={MANY} />);
    fireEvent.click(screen.getByRole("button", { name: "Tag: Any tag" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find in Tag" }), { target: { value: "12" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["#tag1112"]);
  });

  it("shows a display text of its own and the set look", () => {
    render(<Pick display="Updated this week" active />);
    expect(screen.getByRole("button", { name: "Project: Updated this week" }).className).toContain("text-accent");
  });

  it("puts a footer under the list, which can close it", () => {
    render(<Pick footer={(close) => <button onClick={close}>Done</button>} />);
    fireEvent.click(screen.getByRole("button", { name: "Project: Any project" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
