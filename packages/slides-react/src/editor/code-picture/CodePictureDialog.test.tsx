// The code panel: the starting points, the code with its line numbers, Run and its errors, Allow to run, and the library.

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { edit, mountDialogs } from "../dialogs/test-kit.tsx";
import { libraryText } from "./library-file.ts";
import { codePictures } from "./model.ts";
import { insertCodePicture } from "./run.ts";
import { setTarget } from "./target.ts";
import type { GeneratorLibraryHost, GeneratorRequest, GeneratorResult, GeneratorTrust, Program } from "./types.ts";

afterEach(cleanup);

const drawn = (): GeneratorResult => ({
  ok: true,
  kind: "svg",
  bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"></svg>'),
  width: 200,
  height: 100,
  inputs: [],
  warnings: ["a font was substituted"],
  logs: ["rows: 3"],
  at: 1_762_000_000_000,
});

const program = (code: string): Program => ({ language: "js", code, inputs: [], output: "svg" });

describe("Insert → Code picture", () => {
  it("begins with the starting points, shows the code of the one picked, and puts the picture on the slide once it has run", async () => {
    const kit = await mountDialogs({ dialog: "code-picture" });
    const runs: GeneratorRequest[] = [];
    Object.assign(kit.host, {
      runGenerator: async (request: GeneratorRequest) => {
        runs.push(request);
        return drawn();
      },
    });
    expect(screen.getByRole("dialog", { name: "Code picture" })).toBeTruthy();
    for (const label of ["Blank", "Bar chart", "Line chart", "Timeline", "2x2 matrix", "Funnel", "Org chart", "Icon grid"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) }), label).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: /Bar chart/ }));
    const code = screen.getByRole("textbox", { name: "Code" }) as HTMLTextAreaElement;
    expect(code.value).toContain("kit.csv(inputs.sales)");
    // The numbers beside the code, and the data the code reads.
    expect(document.querySelectorAll(".ks-cp-margin > div").length).toBe(code.value.split("\n").length);
    expect((screen.getByRole("textbox", { name: "Name of input 1" }) as HTMLInputElement).value).toBe("sales");

    fireEvent.click(screen.getByRole("button", { name: "Add to slide" }));
    await waitFor(() => expect(codePictures(kit.session.deck)).toHaveLength(1));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.code).toBe(code.value);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the line an error came from, in words and in the margin, and puts nothing on the slide", async () => {
    const kit = await mountDialogs({ dialog: "code-picture" });
    Object.assign(kit.host, { runGenerator: async (): Promise<GeneratorResult> => ({ ok: false, error: { message: "ReferenceError: sales is not defined", line: 2, column: 5 } }) });
    fireEvent.click(screen.getByRole("button", { name: /Blank/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to slide" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Line 2: ReferenceError: sales is not defined");
    expect(document.querySelector(".ks-cp-margin .is-error")?.textContent).toBe("2");
    expect(codePictures(kit.session.deck)).toEqual([]);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("runs from the keyboard with Ctrl+Enter in the code", async () => {
    const kit = await mountDialogs({ dialog: "code-picture" });
    const run = vi.fn(async () => drawn());
    Object.assign(kit.host, { runGenerator: run });
    fireEvent.click(screen.getByRole("button", { name: /Blank/ }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Code" }), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it("lists what the library keeps, opens an entry, and keeps a picture there", async () => {
    const entry = libraryText("G-1", "Quarterly bars", { ...program("return kit.svg(10, 10, '');"), output: "png" });
    const library: GeneratorLibraryHost = {
      list: async () => [{ path: "templates/generators/quarterly-bars.generator", id: "G-1", label: "Quarterly bars", output: "png" }],
      read: async () => entry,
      save: vi.fn(async (_text: string) => ({ path: "templates/generators/new.generator", replaced: false })),
    };
    const kit = await mountDialogs({ dialog: "code-picture" });
    Object.assign(kit.host, { runGenerator: async () => drawn(), generatorLibrary: library });
    // The chooser was drawn before the host had a library; opening it again reads the library.
    edit(() => kit.ui.openDialog(null));
    edit(() => kit.ui.openDialog("code-picture"));
    fireEvent.click(await screen.findByRole("button", { name: /Quarterly bars/ }));
    // The entry is read from the library before it opens.
    expect(((await screen.findByRole("textbox", { name: "Code" })) as HTMLTextAreaElement).value).toBe("return kit.svg(10, 10, '');");
    expect((screen.getByRole("radio", { name: "PNG" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    await screen.findByText("Saved to your library as “Quarterly bars”.");
    const saved = vi.mocked(library.save).mock.calls[0]![0];
    expect(JSON.parse(saved)).toMatchObject({ format: "kasten-generator", label: "Quarterly bars", generator: { code: "return kit.svg(10, 10, '');", output: "png" } });
  });
});

describe("Edit code", () => {
  it("holds an agent's code until Allow to run, then runs it and draws the picture again", async () => {
    let allowed = false;
    const trust: GeneratorTrust = { allowed: vi.fn(async () => allowed), allow: vi.fn(async () => void (allowed = true)) };
    const kit = await mountDialogs({ dialog: null });
    Object.assign(kit.host, { runGenerator: async () => drawn(), generatorTrust: trust });
    const made = await insertCodePicture(kit.session, program("return kit.svg(200, 100, 'agent');"), "x");
    if (!("id" in made)) throw new Error("not put on the slide");
    kit.session.elements.patch({ generator: { madeBy: "agent:claude-code" } }, [made.id]);
    edit(() => {
      setTarget(kit.ui, { kind: "edit", slideId: kit.session.state.slideId, id: made.id });
      kit.ui.openDialog("code-picture");
    });
    expect(screen.getByRole("dialog", { name: "Edit code" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Code" }) as HTMLTextAreaElement).value).toBe("return kit.svg(200, 100, 'agent');");

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/An agent wrote this code/);
    expect(trust.allow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Allow to run" }));
    await screen.findByText("The picture on the slide is drawn again.");
    expect(trust.allow).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Warning: a font was substituted")).toBeTruthy();
    expect(screen.getByText("rows: 3")).toBeTruthy();
  });

  it("says so when the picture has no code any more", async () => {
    const kit = await mountDialogs({ dialog: null });
    edit(() => {
      setTarget(kit.ui, { kind: "edit", slideId: kit.session.state.slideId, id: "gone" });
      kit.ui.openDialog("code-picture");
    });
    expect((await screen.findByRole("alert")).textContent).toBe("This picture has no code any more.");
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  });
});
