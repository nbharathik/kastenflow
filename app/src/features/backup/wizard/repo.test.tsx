import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke: (await import("./harness")).answer,
}));
vi.mock("@tauri-apps/api/event", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/event")>()),
  listen: async (name: string, then: (event: { payload: unknown }) => void) => {
    const { bk } = await import("./harness");
    bk.listeners.set(name, then);
    return () => bk.listeners.delete(name);
  },
}));

import { bk, called, check, order, reset, row, signInEnds } from "./harness";
import { openBackupWizard, useBackupWizard } from "./index";
import WizardHost from "./WizardHost";

beforeEach(() => {
  reset({
    github_repos: ({ query, page }) => {
      if (query === "zzz") return { repos: [], hasMore: false };
      return page === 1
        ? { repos: [row("ada/old-backup", { isBackup: true }), row("ada/recipes")], hasMore: true }
        : { repos: [row("ada/ideas")], hasMore: false };
    },
  });
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  useBackupWizard.getState().reset();
});
afterEach(() => cleanup());

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

/** Signed in, on "Use an existing private repo". */
async function existing() {
  render(<WizardHost />);
  act(() => openBackupWizard());
  await screen.findByRole("heading", { name: "Where should your backup go?" });
  click(/^GitHub \(recommended\)/);
  await screen.findByLabelText("Sign-in code");
  await act(async () => signInEnds({ state: "signed", login: "ada" }));
  await screen.findByRole("heading", { name: "Choose the repository" });
  fireEvent.click(screen.getByRole("radio", { name: "Use an existing private repo" }));
  await screen.findByRole("list", { name: "Private repositories" });
}

describe("using an existing private repository", () => {
  it("lists private repositories, the KastenFlow backups marked, and pages on request", async () => {
    await existing();
    expect(screen.getByText("KastenFlow backup")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([expect.stringContaining("ada/old-backup"), expect.stringContaining("ada/recipes")]);
    click("Show more");
    expect(await screen.findByRole("button", { name: /ada\/ideas/ })).toBeTruthy();
    expect(called("github_repos").map(([, args]) => args)).toEqual([
      { query: "", page: 1 },
      { query: "", page: 2 },
    ]);
  });

  it("searches as you type, and says when nothing matches", async () => {
    await existing();
    fireEvent.change(screen.getByLabelText("Search your private repositories"), { target: { value: "zzz" } });
    expect(await screen.findByText("No private repository matches that.", {}, { timeout: 2000 })).toBeTruthy();
    expect(called("github_repos").at(-1)![1]).toEqual({ query: "zzz", page: 1 });
    click("Create a new one");
    expect(await screen.findByLabelText("Repository name")).toBeTruthy();
  });

  it("uses an empty repository at once", async () => {
    bk.handlers.github_repo_check = () => check({ empty: true, content: "empty" });
    await existing();
    click(/ada\/recipes/);
    expect(await screen.findByText("Backed up · private · ada/recipes · protection on")).toBeTruthy();
    expect(called("backup_link_existing")[0]![1]).toEqual({ url: "https://github.com/ada/recipes.git" });
    expect(called("get_latest")).toHaveLength(0);
    expect(called("push_now")).toHaveLength(1);
  });

  it("joins a repository that holds this vault's history, getting the latest first", async () => {
    bk.handlers.backup_link_existing = () => ({ result: "linked", empty: false, behind: true, status: {} });
    await existing();
    click(/ada\/old-backup/);
    await screen.findByText(/^Backed up/);
    const [link, latest, push] = order("backup_link_existing", "get_latest", "push_now");
    expect(link).toBeGreaterThanOrEqual(0);
    expect(link! < latest! && latest! < push!).toBe(true);
  });

  it("refuses unrelated content with three ways out", async () => {
    bk.handlers.github_repo_check = () => check({ content: "unrelated" });
    await existing();
    click(/ada\/recipes/);
    expect(await screen.findByText("ada/recipes holds something else")).toBeTruthy();
    for (const name of ["Pick another", "Create a new one", "Restore that backup into a new folder"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(called("backup_link_existing")).toHaveLength(0);
    // Nothing is written to it.
    expect(called("push_now")).toHaveLength(0);

    click("Restore that backup into a new folder");
    expect(await screen.findByRole("dialog", { name: "An empty folder to restore the backup into" })).toBeTruthy();
    act(() => useBackupWizard.getState().patch({ picker: null }));

    click("Pick another");
    expect(await screen.findByRole("list", { name: "Private repositories" })).toBeTruthy();
  });

  it("refuses when the core says the history shares nothing", async () => {
    bk.handlers.backup_link_existing = () => ({ result: "refused", choices: ["pickAnother", "createNew", "restoreIntoNewFolder"] });
    await existing();
    click(/ada\/recipes/);
    expect(await screen.findByText("ada/recipes holds something else")).toBeTruthy();
    expect(called("push_now")).toHaveLength(0);
    click("Create a new one");
    expect(await screen.findByLabelText("Repository name")).toBeTruthy();
  });

  it("says when GitHub shows no such repository", async () => {
    bk.handlers.github_repo_check = () => check({ exists: false });
    await existing();
    click(/ada\/recipes/);
    expect((await screen.findByRole("alert")).textContent).toBe("GitHub shows no repository by that name to this sign-in.");
  });
});

describe("a public repository", () => {
  beforeEach(() => {
    bk.handlers.github_repo_check = () => check({ visibility: "public" });
  });

  it("is held back until the person chooses; nothing is pushed first", async () => {
    await existing();
    click(/ada\/recipes/);
    expect(await screen.findByText("ada/recipes is public")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Make it private" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I want a public backup" })).toBeTruthy();
    expect(called("backup_link_existing")).toHaveLength(0);
    expect(called("push_now")).toHaveLength(0);
  });

  it("makes it private and then backs up", async () => {
    await existing();
    click(/ada\/recipes/);
    await screen.findByText("ada/recipes is public");
    click("Make it private");
    expect(await screen.findByText(/^Backed up · private · ada\/recipes/)).toBeTruthy();
    expect(called("github_make_private")[0]![1]).toEqual({ repo: "ada/recipes" });
    expect(order("github_make_private", "backup_link_existing", "push_now").every((n, i, all) => n >= 0 && (i === 0 || n > all[i - 1]!))).toBe(true);
  });

  it("keeps it public only when the person says so", async () => {
    await existing();
    click(/ada\/recipes/);
    await screen.findByText("ada/recipes is public");
    click("I want a public backup");
    expect(await screen.findByText(/^Backed up · public · ada\/recipes/)).toBeTruthy();
    expect(called("github_allow_public")[0]![1]).toEqual({ repo: "ada/recipes" });
  });

  it("holds a repository the backend calls public even when the check did not", async () => {
    bk.handlers.github_repo_check = () => check();
    bk.handlers.backup_link_existing = () => {
      throw { kind: "publicRepo", message: "ada/recipes is a public repository.", repo: "ada/recipes" };
    };
    await existing();
    click(/ada\/recipes/);
    expect(await screen.findByText("ada/recipes is public")).toBeTruthy();
    expect(called("push_now")).toHaveLength(0);
  });
});
