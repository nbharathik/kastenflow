// "Your setups" in the New project dialog: the setups saved from projects are
// listed under the built-in ones, start a project the same way, and can be
// renamed in place or deleted (to the trash, with an Undo).

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppliedSetup, SetupGone, SetupInfo, SetupPlan, SetupTarget } from "../../../lib/vault/project-types";
import type { VaultClient } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { NewProject } from "./NewProject";

const BUILT_IN: SetupInfo[] = [{ id: "research", icon: "🔬", name: "Research", summary: "A reading list and questions.", files: [], tags: [] }];
const MINE: SetupInfo = { id: "saved:trip-kit", icon: "🎓", name: "Trip kit", summary: "2 pages and 1 tag database saved from one of your projects.", files: ["pages/plan.md"], tags: ["paper"], saved: true };

function plan(id: string, target: SetupTarget): SetupPlan {
  const folder = (target.kind === "new" ? target.title : target.folder).toLowerCase().replace(/\s+/g, "-");
  const base = `projects/${folder}`;
  return { projectPath: `${base}/_project.md`, home: `${base}/pages/plan.md`, create: [`${base}/_project.md`, `${base}/pages/plan.md`], keep: id === "research" ? [] : [`${base}/tags`], props: [] };
}

function fake(extra: Record<string, unknown> = {}) {
  let list: SetupInfo[] = [...BUILT_IN, MINE];
  const client = {
    label: "test-vault",
    kind: "vault",
    listSetups: vi.fn(async () => list),
    previewSetup: vi.fn(async (id: string, target: SetupTarget) => plan(id, target)),
    applySetup: vi.fn(async (id: string, target: SetupTarget): Promise<AppliedSetup> => ({ projectPath: plan(id, target).projectPath, home: plan(id, target).home, written: plan(id, target).create, kept: [], commit: "abc" })),
    renameSetup: vi.fn(async (id: string, name: string) => {
      list = list.map((s) => (s.id === id ? { ...s, name } : s));
      return list.find((s) => s.id === id)!;
    }),
    trashSetup: vi.fn(async (id: string): Promise<SetupGone> => {
      list = list.filter((s) => s.id !== id);
      return { id, trashed: ".trash/x/templates/setups/trip-kit.yaml", commit: "g1" };
    }),
    undoCommit: vi.fn(async () => {
      list = [...BUILT_IN, MINE];
    }),
    create: vi.fn(),
    list: vi.fn(async () => []),
    ...extra,
  };
  useWorkspace.setState({ client: client as unknown as VaultClient, ready: true, notes: [], ...derive(initialLayout()), toasts: [], stack: [], stackOpen: false });
  return client;
}

const toasts = () => useWorkspace.getState().toasts;
const names = () => within(screen.getByRole("radiogroup", { name: "Start from" })).getAllByRole("radio").map((r) => r.querySelector(".kasten-hub-setup-name")!.textContent);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("Your setups in the New project dialog", () => {
  it("lists the saved setups under the built-in ones with a heading, and the arrow keys go through all of them", async () => {
    fake();
    render(<NewProject onClose={() => {}} />);
    await screen.findByRole("radio", { name: /Trip kit/ });
    expect(names()).toEqual(["Blank", "Research", "Trip kit"]);
    expect(screen.getByText("Your setups")).toBeTruthy();
    const research = screen.getByRole("radio", { name: /Research/ });
    fireEvent.click(research);
    research.focus();
    fireEvent.keyDown(research, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: /Trip kit/ }).getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("radio", { name: /Trip kit/ })));
  });

  it("shows no heading when there are none", async () => {
    fake({ listSetups: vi.fn(async () => BUILT_IN) });
    render(<NewProject onClose={() => {}} />);
    await screen.findByRole("radio", { name: /Research/ });
    expect(screen.queryByText("Your setups")).toBeNull();
  });

  it("previews and makes a project from a saved setup like from a built-in one", async () => {
    const client = fake();
    const onClose = vi.fn();
    render(<NewProject onClose={onClose} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Trip kit/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "Rome" } });
    await waitFor(() => expect(client.previewSetup).toHaveBeenLastCalledWith("saved:trip-kit", { kind: "new", title: "Rome" }));
    await screen.findByText(/It makes:/);
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.applySetup).toHaveBeenCalledWith("saved:trip-kit", { kind: "new", title: "Rome" });
    expect(toasts().at(-1)?.text).toBe("Created “Rome” from Trip kit");
  });

  it("renames in place: Enter keeps the name without creating anything, Escape leaves it and the dialog open", async () => {
    const client = fake();
    const onClose = vi.fn();
    render(<NewProject onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename the setup “Trip kit”" }));
    let field = screen.getByRole("textbox", { name: "New name for the setup “Trip kit”" }) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "Road kit" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(client.renameSetup).toHaveBeenCalledWith("saved:trip-kit", "Road kit"));
    await waitFor(() => expect(names()).toEqual(["Blank", "Research", "Road kit"]));
    expect(client.applySetup).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Rename the setup “Road kit”" }));
    field = screen.getByRole("textbox", { name: "New name for the setup “Road kit”" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Nope" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: /New name/ })).toBeNull();
    expect(client.renameSetup).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(names()).toEqual(["Blank", "Research", "Road kit"]);
  });

  it("says why a rename was refused and keeps the old name", async () => {
    fake({
      renameSetup: vi.fn(async () => {
        throw new Error("A setup's name is some text on one line, up to 100 characters");
      }),
    });
    render(<NewProject onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename the setup “Trip kit”" }));
    const field = screen.getByRole("textbox", { name: /New name/ });
    fireEvent.change(field, { target: { value: "x".repeat(200) } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(toasts().at(-1)?.text).toBe("A setup's name is some text on one line, up to 100 characters"));
    expect(names()).toEqual(["Blank", "Research", "Trip kit"]);
  });

  it("deletes to the trash with an Undo, and goes back to Blank when the chosen one was deleted", async () => {
    const client = fake();
    render(<NewProject onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Trip kit/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete the setup “Trip kit”" }));
    await waitFor(() => expect(client.trashSetup).toHaveBeenCalledWith("saved:trip-kit"));
    await waitFor(() => expect(names()).toEqual(["Blank", "Research"]));
    expect(screen.getByRole("radio", { name: /Blank/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Your setups")).toBeNull();
    expect(toasts().at(-1)?.text).toBe("Moved the setup “Trip kit” to the trash");
    toasts().at(-1)!.action!.run();
    await waitFor(() => expect(client.undoCommit).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(names()).toEqual(["Blank", "Research", "Trip kit"]));
    expect(toasts().at(-1)?.text).toBe("Brought the setup “Trip kit” back");
  });
});
