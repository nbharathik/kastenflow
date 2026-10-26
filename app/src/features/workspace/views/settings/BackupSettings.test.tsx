// Settings → Backup: each option writes the vault's settings through the
// client, and keeps the other settings as they were.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("../../../backup/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../backup/api")>()), canBackUp: () => true }));
vi.mock("./SafetyRows", () => ({ SafetyRows: () => null }));
vi.mock("../VaultSafety", () => ({ VaultSafety: () => null }));

import { WHEN } from "../../../backup/schedule";
import { useWorkspace } from "../../store";
import { BackupSettings } from "./BackupSettings";

const config = { git: { push_delay_seconds: 120, push_interval_minutes: 60, other: 1 }, backup: { get_latest: "auto", fetch_interval: 15, keep_files: 7, other: "kept" } };
const setConfig = vi.fn(async () => {});

beforeEach(() => {
  setConfig.mockClear();
  useWorkspace.setState({ client: { kind: "desktop", getConfig: async () => structuredClone(config), setConfig } as never });
});
afterEach(cleanup);

const written = () => (setConfig.mock.calls.at(-1) as unknown as [typeof config])[0];

describe("Settings → Backup options", () => {
  it("writes When to back up as the two numbers, keeping the rest of the git settings", async () => {
    render(<BackupSettings />);
    fireEvent.click(await screen.findByRole("radio", { name: "Every hour" }));
    await waitFor(() => expect(setConfig).toHaveBeenCalled());
    expect(written().git).toMatchObject({ ...WHEN.hourly, other: 1 });
    fireEvent.click(screen.getByRole("radio", { name: "Only when I close or by hand" }));
    await waitFor(() => expect(setConfig).toHaveBeenCalledTimes(2));
    expect(written().git).toMatchObject(WHEN.hand);
  });

  it("writes Changes from other computers and how often to look", async () => {
    render(<BackupSettings />);
    fireEvent.click(await screen.findByRole("radio", { name: "Ask me" }));
    await waitFor(() => expect(setConfig).toHaveBeenCalled());
    expect(written().backup).toMatchObject({ get_latest: "ask", fetch_interval: 15, other: "kept" });
    fireEvent.change(screen.getByLabelText("Minutes between looks at the backup"), { target: { value: "30" } });
    await waitFor(() => expect(setConfig).toHaveBeenCalledTimes(2));
    expect(written().backup).toMatchObject({ fetch_interval: 30 });
    fireEvent.click(screen.getByRole("radio", { name: "Only by hand" }));
    await waitFor(() => expect(setConfig).toHaveBeenCalledTimes(3));
    expect(written().backup).toMatchObject({ get_latest: "manual" });
  });

  it("writes how many backup files to keep, between 3 and 60", async () => {
    render(<BackupSettings />);
    const keep = await screen.findByLabelText("How many backup files to keep");
    fireEvent.change(keep, { target: { value: "20" } });
    await waitFor(() => expect(setConfig).toHaveBeenCalled());
    expect(written().backup).toMatchObject({ keep_files: 20 });
    fireEvent.change(keep, { target: { value: "500" } });
    await waitFor(() => expect(setConfig).toHaveBeenCalledTimes(2));
    expect(written().backup).toMatchObject({ keep_files: 60 });
  });
});
