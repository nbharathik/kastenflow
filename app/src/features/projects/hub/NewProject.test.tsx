// "New project": the name, the setup to start from, what it would make, and
// making it in one step that Undo takes back.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppliedSetup, SetupInfo, SetupPlan, SetupTarget } from "../../../lib/vault/project-types";
import type { VaultClient } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { fileOf } from "./hub-test-kit";
import { NewProject } from "./NewProject";
import { projectNote } from "./test-support";

const SETUPS: SetupInfo[] = [
  { id: "research", icon: "🔬", name: "Research", summary: "A reading list, questions and a whiteboard.", files: [], tags: [] },
  { id: "presentation", icon: "🎤", name: "Presentation", summary: "An outline, notes and a deck.", files: [], tags: [] },
];

function planFor(id: string, target: SetupTarget): SetupPlan {
  const title = target.kind === "new" ? target.title : target.folder;
  const folder = title.toLowerCase().replace(/\s+/g, "-");
  const base = `projects/${folder}`;
  return {
    projectPath: `${base}/_project.md`,
    home: `${base}/pages/Reading list.md`,
    create: id === "research" ? [`${base}/_project.md`, `${base}/pages/Reading list.md`, `${base}/pages/Questions.md`, `${base}/map.canvas`] : [`${base}/_project.md`, `${base}/pages/Outline.md`, `${base}/talk.deck`],
    keep: [],
    props: [],
  };
}

function fake(extra: Record<string, unknown> = {}) {
  const client = {
    label: "test-vault",
    kind: "vault",
    listSetups: vi.fn(async () => SETUPS),
    previewSetup: vi.fn(async (id: string, target: SetupTarget) => planFor(id, target)),
    applySetup: vi.fn(async (id: string, target: SetupTarget): Promise<AppliedSetup> => {
      const plan = planFor(id, target);
      return { projectPath: plan.projectPath, home: plan.home, written: plan.create, kept: [], commit: "abc123" };
    }),
    undoCommit: vi.fn(async () => undefined),
    create: vi.fn(async (draft: { title: string }) => fileOf(projectNote(draft.title.toLowerCase(), draft.title))),
    trash: vi.fn(async () => "trashed-1"),
    list: vi.fn(async () => []),
    ...extra,
  };
  useWorkspace.setState({ client: client as unknown as VaultClient, ready: true, notes: [], ...derive(initialLayout()), toasts: [], stack: [], stackOpen: false });
  return client;
}

const name = () => screen.getByRole("textbox", { name: "Project name" }) as HTMLInputElement;
const create = () => screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement;
const toasts = () => useWorkspace.getState().toasts;

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("the New project dialog", () => {
  it("offers a blank project and the setups, with the blank one chosen, and waits for a name", async () => {
    fake();
    render(<NewProject onClose={() => {}} />);
    const choices = within(await screen.findByRole("radiogroup", { name: "Start from" }));
    await waitFor(() => expect(choices.getAllByRole("radio").map((r) => r.querySelector(".kasten-hub-setup-name")!.textContent)).toEqual(["Blank", "Research", "Presentation"]));
    expect(choices.getByRole("radio", { name: /Blank/ }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(name());
    expect(create().disabled).toBe(true);
    fireEvent.change(name(), { target: { value: "Thesis" } });
    expect(create().disabled).toBe(false);
    expect(screen.getByText("It makes the project page and nothing else.")).toBeTruthy();
  });

  it("shows what a setup would make before anything is written, for the name typed", async () => {
    const client = fake();
    render(<NewProject onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Research/ }));
    expect(screen.getByText("Working out what it makes…")).toBeTruthy();
    const plan = within(screen.getByRole("region", { name: "What it makes" }));
    expect(await plan.findByText("It makes: The project page, 2 pages and 1 whiteboard.")).toBeTruthy();
    expect(client.previewSetup).toHaveBeenLastCalledWith("research", { kind: "new", title: "New project" });
    expect(plan.getByText("Reading list, Questions")).toBeTruthy();
    expect(plan.getByText("map")).toBeTruthy();
    fireEvent.change(name(), { target: { value: "Thesis" } });
    await waitFor(() => expect(client.previewSetup).toHaveBeenLastCalledWith("research", { kind: "new", title: "Thesis" }));
    fireEvent.click(screen.getByRole("radio", { name: /Presentation/ }));
    expect(await plan.findByText("It makes: The project page, 1 page and 1 deck.")).toBeTruthy();
    expect(client.applySetup).not.toHaveBeenCalled();
    expect(client.create).not.toHaveBeenCalled();
  });

  it("moves between the choices with the arrow keys", async () => {
    fake();
    render(<NewProject onClose={() => {}} />);
    const blank = await screen.findByRole("radio", { name: /Blank/ });
    await screen.findByRole("radio", { name: /Research/ });
    blank.focus();
    fireEvent.keyDown(blank, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: /Research/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /Blank/ }).tabIndex).toBe(-1);
    // The focus follows the choice.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Research/ })));
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: /Blank/ }).getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Blank/ })));
  });

  it("says why a name is refused and does not let it be created", async () => {
    fake({
      previewSetup: vi.fn(async () => {
        throw new Error("A title needs some text and no [ ] or | characters");
      }),
    });
    render(<NewProject onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Research/ }));
    fireEvent.change(name(), { target: { value: "A [bad] name" } });
    expect(await screen.findByText("A title needs some text and no [ ] or | characters")).toBeTruthy();
    expect(create().disabled).toBe(true);
  });

  it("makes a blank project on Enter, opens it, and Undo moves it to the trash", async () => {
    const client = fake();
    const onClose = vi.fn();
    render(<NewProject onClose={onClose} />);
    fireEvent.change(name(), { target: { value: "Thesis" } });
    fireEvent.submit(name().closest("form")!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "project", title: "Thesis", template: null }));
    expect(client.applySetup).not.toHaveBeenCalled();
    expect(useWorkspace.getState().place.path).toBe("projects/thesis/_project.md");
    expect(toasts().at(-1)?.text).toBe("Created “Thesis”");
    toasts().at(-1)!.action!.run();
    await waitFor(() => expect(client.trash).toHaveBeenCalledWith("projects/thesis/_project.md"));
  });

  it("makes a project from a setup in one step, opens its home, and Undo takes the commit back", async () => {
    const client = fake();
    const onClose = vi.fn();
    render(<NewProject onClose={onClose} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Research/ }));
    fireEvent.change(name(), { target: { value: "Thesis" } });
    await screen.findByText("It makes: The project page, 2 pages and 1 whiteboard.");
    fireEvent.click(create());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.applySetup).toHaveBeenCalledTimes(1);
    expect(client.applySetup).toHaveBeenCalledWith("research", { kind: "new", title: "Thesis" });
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "projects/thesis/pages/Reading list.md" });
    expect(toasts().at(-1)?.text).toBe("Created “Thesis” from Research");
    toasts().at(-1)!.action!.run();
    await waitFor(() => expect(client.undoCommit).toHaveBeenCalledWith("abc123"));
    await waitFor(() => expect(toasts().at(-1)?.text).toBe("Took “Thesis” back out"));
  });

  it("offers no Undo for a vault without history", async () => {
    fake({
      applySetup: vi.fn(async (id: string, target: SetupTarget) => ({ ...(await Promise.resolve(planFor(id, target))), written: [], kept: [], commit: null })),
    });
    render(<NewProject onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Research/ }));
    fireEvent.change(name(), { target: { value: "Thesis" } });
    fireEvent.click(create());
    await waitFor(() => expect(toasts().at(-1)?.text).toBe("Created “Thesis” from Research"));
    expect(toasts().at(-1)?.action).toBeUndefined();
  });

  it("stays open and says why when the core refuses", async () => {
    const onClose = vi.fn();
    fake({
      applySetup: vi.fn(async () => {
        throw new Error("That project name was taken meanwhile; try again");
      }),
    });
    render(<NewProject onClose={onClose} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Research/ }));
    fireEvent.change(name(), { target: { value: "Thesis" } });
    fireEvent.click(create());
    await waitFor(() => expect(toasts().at(-1)?.text).toBe("That project name was taken meanwhile; try again"));
    expect(onClose).not.toHaveBeenCalled();
    expect(create().disabled).toBe(false);
  });

  it("closes on Escape and on Cancel without making anything", async () => {
    const client = fake();
    const onClose = vi.fn();
    render(<NewProject onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(client.create).not.toHaveBeenCalled();
    expect(client.applySetup).not.toHaveBeenCalled();
  });

  it("still offers a blank project when the setups cannot be listed", async () => {
    fake({
      listSetups: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    render(<NewProject onClose={() => {}} />);
    expect(await screen.findAllByRole("radio")).toHaveLength(1);
  });
});
