import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistIndex } from "./completion/data";
import { ErrorList, summary } from "./ErrorList";
import { Outline } from "./Outline";
import type { DocFile, Diagnostic } from "./types";

const FOLDER = "projects/p/latex/paper";
const FILES: DocFile[] = [
  { path: `${FOLDER}/main.tex`, editable: true, size: 1 },
  { path: `${FOLDER}/sections/intro.tex`, editable: true, size: 1 },
  { path: `${FOLDER}/paper.log`, editable: false, size: 1 },
];
const d = (over: Partial<Diagnostic>): Diagnostic => ({ file: "main.tex", line: 3, severity: "error", message: "Undefined control sequence.", ...over });

afterEach(cleanup);

describe("the problem list under the editor", () => {
  const list = (diagnostics: Diagnostic[], onJump = vi.fn()) => {
    render(<ErrorList diagnostics={diagnostics} folder={FOLDER} main="main.tex" files={FILES} onJump={onJump} />);
    return onJump;
  };

  it("shows nothing when the build had nothing to say", () => {
    const { container } = render(<ErrorList diagnostics={[]} folder={FOLDER} main="main.tex" files={FILES} onJump={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("counts, puts errors first, and names file and line", () => {
    list([d({ severity: "warning", message: "Overfull", line: 9 }), d({ message: "Boom" }), d({ severity: "info", message: "Noted", line: null })]);
    expect(screen.getByText("1 error, 1 warning, 1 note")).toBeTruthy();
    const rows = within(screen.getByRole("region", { name: "Problems from the last build" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Errormain.tex:3Boom", "Warningmain.tex:9Overfull", "Notemain.tex" + "Noted"]);
  });

  it("jumps to the file and line when a problem is clicked or Enter is pressed", () => {
    const onJump = list([d({ file: "sections/intro.tex", line: 5, message: "In the intro" }), d({ file: null, line: 2, message: "In the root" })]);
    fireEvent.click(screen.getByRole("button", { name: /In the intro/ }));
    expect(onJump).toHaveBeenLastCalledWith(`${FOLDER}/sections/intro.tex`, 5);
    screen.getByRole("button", { name: /In the root/ }).focus();
    fireEvent.click(document.activeElement!);
    expect(onJump).toHaveBeenLastCalledWith(`${FOLDER}/main.tex`, 2);
  });

  it("lists a problem in a file the editor cannot open, without a button", () => {
    list([d({ file: "paper.log", line: 1, message: "Elsewhere" })]);
    expect(screen.getByText("Elsewhere")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Elsewhere/ })).toBeNull();
  });

  it("moves between problems with the arrow keys and folds away", () => {
    list([d({ message: "One" }), d({ message: "Two", line: 4 })]);
    const first = screen.getByRole("button", { name: /One/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Two/ }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "Hide the problems" }));
    expect(screen.queryByText("One")).toBeNull();
    expect(screen.getByRole("button", { name: "Show the problems" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("summarises in plain words", () => {
    expect(summary([d({}), d({})])).toBe("2 errors");
    expect(summary([d({ severity: "warning" })])).toBe("1 warning");
  });
});

describe("the outline", () => {
  const index = () => new AssistIndex({ folder: FOLDER, files: () => FILES, read: () => Promise.resolve(""), vaultCites: () => Promise.resolve([]) }, 10);

  it("lists the headings of the open file, indented by level, and jumps to one", () => {
    const i = index();
    const path = `${FOLDER}/main.tex`;
    i.setText(path, "\\section{Intro}\ntext\n\\subsection{Why}\n\\section*{Thanks}", true);
    const onJump = vi.fn();
    render(<Outline index={i} path={path} onJump={onJump} onAdd={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Intro1", "Why3", "Thanks4"]);
    expect(buttons[1]!.style.paddingLeft).not.toBe(buttons[0]!.style.paddingLeft);
    fireEvent.click(buttons[1]!);
    expect(onJump).toHaveBeenCalledWith(3);
  });

  it("follows the text a moment after typing stops", async () => {
    const i = index();
    const path = `${FOLDER}/main.tex`;
    i.setText(path, "\\section{Old}", true);
    render(<Outline index={i} path={path} onJump={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Old/ })).toBeTruthy();
    i.setText(path, "\\section{New}");
    await waitFor(() => expect(screen.getByRole("button", { name: /New/ })).toBeTruthy());
  });

  it("says there are no headings and offers to add a section", () => {
    const onAdd = vi.fn();
    render(<Outline index={index()} path={`${FOLDER}/sections/intro.tex`} onJump={vi.fn()} onAdd={onAdd} />);
    expect(screen.getByText("No headings in this file yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a section" }));
    expect(onAdd).toHaveBeenCalled();
  });
});
