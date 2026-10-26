import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => vi.fn());
vi.mock("../backup/wizard/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../backup/wizard/api")>()),
  call: calls,
}));
vi.mock("../backup/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../backup/api")>()),
  canBackUp: () => true,
  githubAccount: vi.fn(async () => ({ login: null, signedIn: false, canSignIn: false, suggested: null })),
  onSignIn: () => () => {},
  restoreFromFile: vi.fn(async () => {}),
  restoreFromGit: vi.fn(async () => {}),
}));

import * as api from "../backup/api";
import { RestoreCard } from "./RestoreCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const type = (label: string, value: string) => fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });

describe("restoring from a backup", () => {
  it("restores a backup file into a new folder", async () => {
    render(<RestoreCard location="/home/a/Documents" onLocation={() => {}} />);
    expect(screen.queryByRole("button", { name: "GitHub" })).toBeNull();
    type("Backup file", "/home/a/Dropbox/kasten-notes-desk.bundle");
    type("Name", "Notes");
    expect(screen.getByText("/home/a/Documents/Notes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.restoreFromFile).toHaveBeenCalledWith("/home/a/Dropbox/kasten-notes-desk.bundle", "/home/a/Documents/Notes"));
  });

  it("restores a git address, with a token for an https one", async () => {
    render(<RestoreCard location="/home/a/Documents" onLocation={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Git address" }));
    type("Git address", "https://git.example.com/me/notes.git");
    type("User name", "me");
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: "s3cret-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.restoreFromGit).toHaveBeenCalledWith("https://git.example.com/me/notes.git", "/home/a/Documents/Kasten", "s3cret-token", "me"));
  });

  it("lists GitHub backups first, searches, pages and restores the chosen one", async () => {
    vi.mocked(api.githubAccount).mockResolvedValue({ login: "me", signedIn: true, canSignIn: true, suggested: null });
    const row = (name: string, isBackup: boolean) => ({ name, fullName: `me/${name}`, cloneUrl: `https://github.com/me/${name}.git`, htmlUrl: "", updatedAt: null, visibility: "private", isBackup });
    calls.mockImplementation(async (_n: string, args: { query: string; page: number }) => {
      if (args.query === "notes") return { repos: [row("notes-2", false)], hasMore: false };
      if (args.page === 2) return { repos: [row("other", false)], hasMore: false };
      return { repos: [row("kastenflow-notes", true), row("plain", false)], hasMore: true };
    });
    render(<RestoreCard location="/home/a/Documents" onLocation={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "GitHub" }));
    const first = await screen.findAllByRole("button", { name: /me\// });
    expect(first[0]?.textContent).toContain("me/kastenflow-notes");
    expect(first[0]?.textContent).toContain("KastenFlow backup");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await screen.findByRole("button", { name: /me\/other/ });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "notes" } });
    fireEvent.click(await screen.findByRole("button", { name: /me\/notes-2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.restoreFromGit).toHaveBeenCalledWith("https://github.com/me/notes-2.git", "/home/a/Documents/notes-2"));
  });

  it("asks for a token only for an https address", () => {
    render(<RestoreCard location="/home/a/Documents" onLocation={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Git address" }));
    type("Git address", "git@example.com:me/notes.git");
    expect(screen.queryByLabelText("Token")).toBeNull();
  });
});
