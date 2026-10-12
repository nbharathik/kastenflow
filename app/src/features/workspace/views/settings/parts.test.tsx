// The rows of Settings: a name and a ? for the explanation, the control, a dot
// and a way back when it differs from the usual; and how they behave while a
// search is on.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Block, Extra, Group, Marked, Note, resetOf, Row, Switch } from "./parts";
import { IDLE, SettingsViewContext, type SettingsView } from "./view";

afterEach(cleanup);

const control = <button type="button">control</button>;

describe("a row", () => {
  it("takes its name from the index and keeps the explanation behind a ?", () => {
    render(<Row id="appearance.accent">{control}</Row>);
    expect(screen.getByText("Accent colour")).toBeTruthy();
    expect(screen.queryByText(/Buttons, selection and highlights/)).toBeNull();
    const help = screen.getByRole("button", { name: "About Accent colour" });
    expect(help.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(help);
    expect(help.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Buttons, selection and highlights.");
    fireEvent.click(help);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens the explanation on hover, keeps it when clicked, and closes it with Escape or a click elsewhere", () => {
    render(
      <>
        <Row id="appearance.accent">{control}</Row>
        <p>elsewhere</p>
      </>,
    );
    const help = screen.getByRole("button", { name: "About Accent colour" });
    const tip = help.parentElement!;
    fireEvent.mouseEnter(tip);
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.mouseLeave(tip);
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(help);
    fireEvent.mouseLeave(tip);
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.keyDown(help, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(help);
    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("has no ? when there is nothing more to say, and takes an explanation of its own", () => {
    const { rerender } = render(<Row label="Plain">{control}</Row>);
    expect(screen.queryByRole("button", { name: /^About/ })).toBeNull();
    rerender(
      <Row label="Plain" help="More about it.">
        {control}
      </Row>,
    );
    fireEvent.click(screen.getByRole("button", { name: "About Plain" }));
    expect(screen.getByRole("status").textContent).toBe("More about it.");
  });

  it("keeps a short line of status under the name, and puts a long text behind the ?", () => {
    const { rerender } = render(
      <Row label="Updates" detail="Checked just now">
        {control}
      </Row>,
    );
    expect(screen.getByText("Checked just now")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "About Updates" })).toBeNull();

    const long = "This is a long explanation of what the row does, and it does not belong under the name of a compact row.";
    rerender(
      <Row label="Updates" detail={long}>
        {control}
      </Row>,
    );
    expect(screen.queryByText(long)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "About Updates" }));
    expect(screen.getByRole("status").textContent).toBe(long);

    // A status that is not a plain string stays, however long.
    rerender(
      <Row label="Updates" detail={<>{long}</>}>
        {control}
      </Row>,
    );
    expect(screen.getByText(long)).toBeTruthy();
  });

  it("shows a dot, and a way back that is named, only when it differs from the usual", () => {
    const back = vi.fn();
    const { rerender } = render(
      <Row id="appearance.accent" {...resetOf("pink", "blue", back)}>
        {control}
      </Row>,
    );
    expect(screen.getByRole("img", { name: "Changed from the usual" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset Accent colour" }));
    expect(back).toHaveBeenCalledWith("blue");

    rerender(
      <Row id="appearance.accent" {...resetOf("blue", "blue", back)}>
        {control}
      </Row>,
    );
    expect(screen.queryByRole("img", { name: "Changed from the usual" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reset/ })).toBeNull();
  });

  it("can have an icon before its name", () => {
    const { container } = render(
      <Row id="appearance.theme" icon="palette">
        {control}
      </Row>,
    );
    expect(container.querySelector(".kasten-set-label svg")).toBeTruthy();
  });
});

describe("a switch", () => {
  it("is named from the index, and tells when it is not as it starts", () => {
    const set = vi.fn();
    const { rerender } = render(<Switch id="pages.spellcheck" usual checked onChange={set} />);
    const toggle = screen.getByRole("switch", { name: "Check spelling" }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.queryByRole("img", { name: "Changed from the usual" })).toBeNull();
    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith(false);

    rerender(<Switch id="pages.spellcheck" usual checked={false} onChange={set} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset Check spelling" }));
    expect(set).toHaveBeenLastCalledWith(true);
  });
});

describe("a card", () => {
  it("has a small heading when asked, with a ? for more", () => {
    render(
      <Group title="Opening pages" sub help="Where things open.">
        <Row label="A row">{control}</Row>
      </Group>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Opening pages" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "About Opening pages" }));
    expect(screen.getByRole("status").textContent).toBe("Where things open.");
    expect(screen.getByRole("region", { name: "Opening pages" })).toBeTruthy();
  });

  it("has no heading of its own when it is the group's page", () => {
    render(
      <Group title="Sidebar">
        <Row label="A row">{control}</Row>
      </Group>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("region", { name: "Sidebar" })).toBeTruthy();
  });
});

describe("while a search is on", () => {
  const view = (patch: Partial<SettingsView>): SettingsView => ({ ...IDLE, group: "appearance", words: ["zoom"], matching: new Set(["appearance.zoom"]), ...patch });
  const inSearch = (patch: Partial<SettingsView>, children: ReactNode) => render(<SettingsViewContext.Provider value={view(patch)}>{children}</SettingsViewContext.Provider>);

  it("draws only the rows that were found, the card they are in, and not the notes and extras", () => {
    inSearch(
      {},
      <>
        <Group title="Frequently used" sub>
          <Row id="appearance.theme">{control}</Row>
          <Row id="appearance.zoom">
            <button type="button">zoom control</button>
          </Row>
          <Note>a note</Note>
          <Extra>an extra</Extra>
        </Group>
        <Group title="Animation" sub>
          <Row id="appearance.motion">{control}</Row>
        </Group>
      </>,
    );
    expect(screen.getByRole("button", { name: "zoom control" })).toBeTruthy();
    expect(screen.queryByText("Theme")).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Frequently used" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Animation" })).toBeNull();
    expect(screen.queryByText("a note")).toBeNull();
    expect(screen.queryByText("an extra")).toBeNull();
  });

  it("does not draw a row of another group's page, nor one with no name in the index", () => {
    inSearch(
      { matching: new Set(["appearance.zoom", "pages.textSize"]) },
      <>
        <Row id="pages.textSize">{control}</Row>
        <Row label="Nameless">{control}</Row>
      </>,
    );
    expect(screen.queryByText("Text size")).toBeNull();
    expect(screen.queryByText("Nameless")).toBeNull();
  });

  it("marks the words in the name and in the explanation, and says a keyword that found it", () => {
    inSearch(
      { words: ["size", "zoom"], matching: new Set(["appearance.zoom"]) },
      <Row id="appearance.zoom">{control}</Row>,
    );
    const row = document.getElementById("setting-appearance-zoom")!;
    const marks = [...row.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toContain("size");
    // "zoom" is in no sentence of it, only among the words it is known by.
    expect(within(row).getByText(/Also known as/).textContent).toContain("zoom");
    expect(row.querySelector(".kasten-set-name")!.textContent).toBe("Interface size");
  });

  it("shows a big block as a line that opens its group at it", () => {
    const open = vi.fn();
    inSearch(
      { group: "sidebar", words: ["pin"], matching: new Set(["sidebar.views"]), open },
      <Group title="Sidebar">
        <Row id="sidebar.views">{control}</Row>
      </Group>,
    );
    expect(screen.queryByRole("button", { name: "control" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Views in the sidebar in Sidebar" }));
    expect(open).toHaveBeenCalledWith("sidebar.views");
  });

  it("marks the row a jump went to", () => {
    render(
      <SettingsViewContext.Provider value={{ ...IDLE, group: "browser", flash: "browser.addEngine" }}>
        <Block id="browser.addEngine" titled>
          <p>form</p>
        </Block>
      </SettingsViewContext.Provider>,
    );
    const block = document.getElementById("setting-browser-addEngine")!;
    expect(block.classList.contains("is-flash")).toBe(true);
    expect(within(block).getByText("Add a search engine")).toBeTruthy();
    expect(within(block).getByRole("button", { name: "About Add a search engine" })).toBeTruthy();
  });
});

describe("marked words", () => {
  it("are drawn as marks, and plain text is left alone", () => {
    const { container, rerender } = render(<Marked text="Interface size" />);
    expect(container.querySelector("mark")).toBeNull();
    rerender(
      <SettingsViewContext.Provider value={{ ...IDLE, words: ["face"] }}>
        <Marked text="Interface size" />
      </SettingsViewContext.Provider>,
    );
    expect(container.querySelector("mark")!.textContent).toBe("face");
    expect(container.textContent).toBe("Interface size");
  });
});

it("marks only the row that was jumped to", () => {
  render(
    <SettingsViewContext.Provider value={{ ...IDLE, flash: "pages.font" }}>
      <Row id="pages.font">{control}</Row>
      <Row id="pages.textSize">{control}</Row>
    </SettingsViewContext.Provider>,
  );
  expect(document.getElementById("setting-pages-font")!.classList.contains("is-flash")).toBe(true);
  expect(document.getElementById("setting-pages-textSize")!.classList.contains("is-flash")).toBe(false);
});
