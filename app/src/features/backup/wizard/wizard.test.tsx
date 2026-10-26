import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

import { bk, called, check, reset, row, signInEnds, status } from "./harness";
import { openBackupWizard, useBackupWizard } from "./index";
import WizardHost from "./WizardHost";

const writeText = vi.fn(async () => {});

beforeEach(() => {
  reset();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  useBackupWizard.getState().reset();
});
afterEach(() => cleanup());

const show = () => {
  render(<WizardHost />);
  act(() => openBackupWizard());
};
const heading = (name: string) => screen.findByRole("heading", { name });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

/** Opens the panel and takes the GitHub card; the sign-in is approved at once. */
async function signedIn() {
  show();
  await heading("Where should your backup go?");
  click(/^GitHub \(recommended\)/);
  await screen.findByLabelText("Sign-in code");
  await act(async () => signInEnds({ state: "signed", login: "ada" }));
  await heading("Choose the repository");
}

describe("the guided backup setup", () => {
  it("backs up to GitHub in two clicks: the card, then Create", async () => {
    let clicks = 0;
    show();
    await heading("Where should your backup go?");
    expect(screen.getByRole("button", { name: /^GitHub \(recommended\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Another git host/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^A folder or drive/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Both: GitHub and a folder/ })).toBeTruthy();

    clicks++;
    click(/^GitHub \(recommended\)/);
    // The code is large, copied, and GitHub's page is open without a click.
    expect((await screen.findByLabelText("Sign-in code")).textContent).toBe("ABCD-1234");
    expect(writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(called("open_url")[0]![1]).toEqual({ url: "https://github.com/login/device" });
    expect(screen.getByText(/Waiting for you to approve/)).toBeTruthy();

    await act(async () => signInEnds({ state: "signed", login: "ada" }));
    await heading("Choose the repository");
    // The name is filled in from the vault and checked as it stands.
    const name = (await screen.findByLabelText("Repository name")) as HTMLInputElement;
    await vi.waitFor(() => expect(name.value).toBe("my-notes"));
    await screen.findByText("That name is free.");

    clicks++;
    click("Create private repo");
    expect(await screen.findByText("Backed up · private · ada/my-notes · protection on")).toBeTruthy();
    expect(called("github_create_backup")[0]![1]).toEqual({ name: "my-notes" });

    fireEvent.click(screen.getByRole("button", { name: "Open on GitHub" }));
    expect(called("open_url").at(-1)![1]).toEqual({ url: "https://github.com/ada/my-notes" });
    expect(clicks).toBe(2);

    click("Next");
    await heading("How your backup works");
    expect(screen.getByText(/saved chats and the app's settings/)).toBeTruthy();
    click("Done");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useBackupWizard.getState().step).toBe("where");
  });

  it("says why protection is off", async () => {
    bk.handlers.github_create_backup = ({ name }) => ({ ...row(`ada/${name}`), protection: { state: "unprotected", reason: "Branch locks need a paid plan." } });
    await signedIn();
    await screen.findByText("That name is free.");
    click("Create private repo");
    expect(await screen.findByText("Backed up · private · ada/my-notes · protection off (Branch locks need a paid plan.)")).toBeTruthy();
  });

  it("skips the sign-in when already signed in", async () => {
    bk.handlers.github_account = () => ({ login: "ada", signedIn: true, canSignIn: true, suggested: "my-notes" });
    show();
    await heading("Where should your backup go?");
    click(/^GitHub \(recommended\)/);
    await heading("Choose the repository");
    expect(called("github_sign_in_start")).toHaveLength(0);
  });
});

describe("signing in with a code", () => {
  const start = async () => {
    show();
    await heading("Where should your backup go?");
    click(/^GitHub \(recommended\)/);
    await screen.findByLabelText("Sign-in code");
  };

  it("offers a new code when the first one ran out", async () => {
    await start();
    await act(async () => signInEnds({ state: "expired" }));
    expect((await screen.findByRole("alert")).textContent).toContain("ran out");
    bk.handlers.github_sign_in_start = () => ({ userCode: "WXYZ-9999", verificationUri: "https://github.com/login/device", expiresIn: 900 });
    click("Get a new code");
    expect((await screen.findByLabelText("Sign-in code")).textContent).toBe("WXYZ-9999");
    expect(writeText).toHaveBeenLastCalledWith("WXYZ-9999");
  });

  it("says plainly when GitHub sign-in was cancelled, and tries again", async () => {
    await start();
    await act(async () => signInEnds({ state: "denied" }));
    expect((await screen.findByRole("alert")).textContent).toBe("GitHub sign-in was cancelled.");
    click("Try again");
    expect(await screen.findByLabelText("Sign-in code")).toBeTruthy();
    expect(called("github_sign_in_start")).toHaveLength(2);
  });

  it("shows a failed sign-in's sentence", async () => {
    await start();
    await act(async () => signInEnds({ state: "failed", message: "GitHub could not be reached." }));
    expect((await screen.findByRole("alert")).textContent).toBe("GitHub could not be reached.");
  });

  it("opens the token way at once when this build cannot sign in by code", async () => {
    bk.handlers.github_account = () => ({ login: null, signedIn: false, canSignIn: false, suggested: null });
    show();
    await heading("Where should your backup go?");
    click(/^GitHub \(recommended\)/);
    expect((await screen.findByRole("alert")).textContent).toContain("Use a token below");
    expect(screen.getByLabelText("Token")).toBeTruthy();
  });
});

describe("other ways to sign in", () => {
  const start = async () => {
    show();
    await heading("Where should your backup go?");
    click(/^GitHub \(recommended\)/);
    await screen.findByLabelText("Sign-in code");
    click("Other ways to sign in");
  };

  it("opens GitHub's token page, then signs in with the token and the repo", async () => {
    await start();
    click("Open GitHub's token page");
    await vi.waitFor(() => expect(called("open_url").at(-1)![1]).toEqual({ url: "https://github.com/settings/personal-access-tokens/new?name=KastenFlow+backup" }));
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "github_pat_x" } });
    fireEvent.change(screen.getByLabelText("Repository to use (optional)"), { target: { value: "ada/notes" } });
    click("Sign in with token");
    await heading("Choose the repository");
    expect(called("github_token_sign_in")[0]![1]).toEqual({ token: "github_pat_x", repo: "ada/notes" });
  });

  it("shows why a token was refused and stays put", async () => {
    bk.handlers.github_token_sign_in = () => {
      throw { kind: "cannotWrite", message: "That token can see ada/notes but cannot write to it." };
    };
    await start();
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "github_pat_x" } });
    click("Sign in with token");
    expect((await screen.findAllByRole("alert")).some((a) => a.textContent === "That token can see ada/notes but cannot write to it.")).toBe(true);
    expect(screen.getByRole("heading", { name: "Sign in to GitHub" })).toBeTruthy();
  });

  it("hides the GitHub command line when it is not there", async () => {
    await start();
    expect(screen.queryByRole("button", { name: "Use the GitHub command line" })).toBeNull();
  });

  it("signs in with the GitHub command line when it is there", async () => {
    bk.handlers.github_gh_cli_available = () => true;
    await start();
    click("Use the GitHub command line");
    await heading("Choose the repository");
    expect(called("github_gh_cli_sign_in")).toHaveLength(1);
  });
});

describe("making the repository", () => {
  it("turns a taken name into one button that uses the repository that has it", async () => {
    bk.handlers.github_create_backup = () => {
      throw { kind: "nameTaken", message: "ada/my-notes exists.", existing: row("ada/my-notes", { isBackup: true }) };
    };
    bk.handlers.github_repo_check = () => ({ ...check(), content: "empty" });
    await signedIn();
    await screen.findByText("That name is free.");
    click("Create private repo");
    expect(await screen.findByText("That name is taken — use the existing repo?")).toBeTruthy();
    click("Use ada/my-notes");
    expect(await screen.findByText("Backed up · private · ada/my-notes · protection on")).toBeTruthy();
    expect(called("backup_link_existing")[0]![1]).toEqual({ url: "https://github.com/ada/my-notes.git" });
  });

  it("notices a taken name while typing", async () => {
    bk.handlers.github_name_available = () => false;
    await signedIn();
    expect(await screen.findByText("That name is taken — use the existing repo?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use ada/my-notes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create private repo" })).toBeNull();
  });

  it("shows a failed backup's sentence with a way to try again", async () => {
    bk.handlers.github_create_backup = () => {
      throw { kind: "offline", message: "You are offline." };
    };
    await signedIn();
    await screen.findByText("That name is free.");
    click("Create private repo");
    expect((await screen.findByRole("alert")).textContent).toBe("You are offline.");
    bk.handlers.github_create_backup = ({ name }) => ({ ...row(`ada/${name}`), protection: { state: "protected", reason: null } });
    expect(useBackupWizard.getState().retry).not.toBeNull();
    click("Try again");
    expect(await screen.findByText(/^Backed up · private/)).toBeTruthy();
    // Nothing left to retry: the closure (which can hold a token) is let go.
    expect(useBackupWizard.getState().retry).toBeNull();
  });

  it("shows progress while the first backup runs", async () => {
    let finish: () => void = () => {};
    bk.handlers.github_create_backup = ({ name }) =>
      new Promise((resolve) => {
        finish = () => resolve({ ...row(`ada/${name}`), protection: { state: "protected", reason: null } });
      });
    bk.handlers.backup_status = () => status({ unpushed: 3, repoSize: 12.4 * 1024 * 1024 });
    await signedIn();
    await screen.findByText("That name is free.");
    click("Create private repo");
    expect(await screen.findByRole("progressbar", { name: "Backing up" })).toBeTruthy();
    expect(await screen.findByText("3 changes left to send · 12.4 MB", {}, { timeout: 3000 })).toBeTruthy();
    await act(async () => finish());
    expect(await screen.findByText(/^Backed up/)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("keeping progress", () => {
  it("continues at the same step when closed with Escape and opened again", async () => {
    await signedIn();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openBackupWizard());
    expect(await heading("Choose the repository")).toBeTruthy();
  });

  it("closes from the first step with Later", async () => {
    show();
    await heading("Where should your backup go?");
    click("Later");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("a keyboard-only run", () => {
  it("moves focus to each step's heading, and every control is a real button or field", async () => {
    show();
    const first = await heading("Where should your backup go?");
    expect(document.activeElement).toBe(first);
    // Cards are buttons: Tab reaches them and Enter or Space presses them.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("button").every((b) => b.tagName === "BUTTON")).toBe(true);
    click(/^GitHub \(recommended\)/);
    await screen.findByLabelText("Sign-in code");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Sign in to GitHub" }));
    await act(async () => signInEnds({ state: "signed", login: "ada" }));
    expect(document.activeElement).toBe(await heading("Choose the repository"));
    // The name field submits on Enter: it is a form.
    const name = await screen.findByLabelText("Repository name");
    await screen.findByText("That name is free.");
    fireEvent.submit(name.closest("form")!);
    expect(await screen.findByText(/^Backed up · private/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your first backup" }));
  });
});

describe("the other places", () => {
  it("backs up to another git host with an address and a token", async () => {
    const config = { name: "v", git: { remote: null } };
    const set = vi.fn(async () => {});
    const { useWorkspace } = await import("../../workspace/store");
    useWorkspace.setState({ client: { getConfig: async () => config, setConfig: set } as never });
    bk.handlers.git_token_save = () => ({ remembered: true });
    show();
    await heading("Where should your backup go?");
    click(/^Another git host/);
    await heading("Another git host");
    fireEvent.change(screen.getByLabelText("Repository address"), { target: { value: "https://git.example.com/ada/notes.git" } });
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "secret" } });
    click("Save and back up");
    expect(await screen.findByText("Backed up · https://git.example.com/ada/notes.git")).toBeTruthy();
    expect(set).toHaveBeenCalledWith({ name: "v", git: { remote: "https://git.example.com/ada/notes.git" } });
    expect(called("git_token_save")[0]![1]).toEqual({ url: "https://git.example.com/ada/notes.git", secret: "secret", username: null });
    useWorkspace.setState({ client: null });
  });

  it("writes the first backup file into a chosen folder", async () => {
    bk.handlers.set_backup_folder = () => null;
    bk.handlers.backup_file_now = () => ({ path: "x", head: "h", written: true, bytes: 1, removed: [], kept: [] });
    show();
    await heading("Where should your backup go?");
    click(/^A folder or drive/);
    await heading("A folder or drive");
    click("Choose folder…");
    // The folder browser takes the panel's place; it is the only dialog.
    expect(await screen.findByRole("dialog", { name: "Where backup files go" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "A folder or drive" })).toBeNull();
    act(() => useBackupWizard.getState().patch({ picker: null }));
    await heading("A folder or drive");
  });

  it("does GitHub first, then the folder, for Both", async () => {
    show();
    await heading("Where should your backup go?");
    click(/^Both: GitHub and a folder/);
    await screen.findByLabelText("Sign-in code");
    await act(async () => signInEnds({ state: "signed", login: "ada" }));
    await screen.findByText("That name is free.");
    click("Create private repo");
    await screen.findByText(/^Backed up · private/);
    click("Next: a folder");
    expect(await heading("A folder or drive")).toBeTruthy();
    click("Skip");
    expect(await heading("How your backup works")).toBeTruthy();
  });
});
