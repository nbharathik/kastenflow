import { describe, expect, it, vi } from "vitest";

import { fakeClock } from "../../../demo/fake-clock";
import { listing } from "./browse";
import { BackupFlow, DEMO_CODE, DEMO_LOGIN, DEMO_REPO, FIRST_BACKUP_MS, SIGN_IN_MS } from "./flow";

function make() {
  const clock = fakeClock();
  const events: { event: string; payload: unknown }[] = [];
  const flow = new BackupFlow(clock, (event, payload) => events.push({ event, payload }));
  return { clock, events, flow };
}

describe("the demo's backup", () => {
  it("starts with no backup and nobody signed in", () => {
    const { flow } = make();
    expect(flow.vaultBackup()).toEqual({ state: "off", lastPush: null, failures: 0, lastError: null });
    expect(flow.account()).toEqual({ login: null, signedIn: false, canSignIn: true, suggested: DEMO_REPO });
    expect(flow.backupNow()).toEqual({ answer: "not", reason: { kind: "noBackup" } });
  });

  it("shows a code, then says signed in after a fixed wait", () => {
    const { flow, clock, events } = make();
    expect(flow.startSignIn().userCode).toBe(DEMO_CODE);
    clock.advance(SIGN_IN_MS - 1);
    expect(events).toEqual([]);
    expect(flow.account().signedIn).toBe(false);
    clock.advance(1);
    expect(events).toEqual([{ event: "kasten://github-sign-in", payload: { state: "signed", login: DEMO_LOGIN } }]);
    expect(flow.account()).toMatchObject({ signedIn: true, login: DEMO_LOGIN });
  });

  it("keeps a sign-in that was approved when the panel lets go of it", () => {
    const { flow, clock } = make();
    flow.startSignIn();
    clock.advance(SIGN_IN_MS);
    flow.cancelSignIn();
    expect(flow.account().signedIn).toBe(true);
  });

  it("cancels a sign-in that is still waiting", () => {
    const { flow, clock, events } = make();
    flow.startSignIn();
    flow.cancelSignIn();
    clock.advance(SIGN_IN_MS * 2);
    expect(events).toEqual([]);
    expect(flow.account().signedIn).toBe(false);
  });

  it("makes the private repository and runs the first backup for three seconds, with fewer changes left each time it is read", async () => {
    const { flow, clock } = make();
    flow.startSignIn();
    clock.advance(SIGN_IN_MS);
    const done = vi.fn();
    const made = flow.createBackup(DEMO_REPO).then(done);
    expect(flow.status().unpushed).toBe(48);
    clock.advance(FIRST_BACKUP_MS / 2);
    expect(flow.status().unpushed).toBe(24);
    expect(flow.vaultBackup().state).toBe("off");
    clock.advance(FIRST_BACKUP_MS / 2);
    await made;
    const repo = done.mock.calls[0]![0] as { fullName: string; visibility: string; protection: { state: string } };
    expect(repo).toMatchObject({ fullName: `${DEMO_LOGIN}/${DEMO_REPO}`, visibility: "private", protection: { state: "protected" } });
    expect(flow.remote).toBe(`https://github.com/${DEMO_LOGIN}/${DEMO_REPO}.git`);
    expect(flow.vaultBackup()).toEqual({ state: "ok", lastPush: clock.now(), failures: 0, lastError: null });
    expect(flow.status()).toMatchObject({ waiting: false, unpushed: 0, visibility: "private" });
  });

  it("ages the last backup for 'Backed up 2 minutes ago'", () => {
    const { flow, clock } = make();
    flow.preset("backedUp");
    flow.ageMinutes(2);
    expect(flow.vaultBackup().lastPush).toBe(clock.now() - 120_000);
  });

  it("can start with an amber 'not backed up' bar, and goes back to where it began", () => {
    const { flow } = make();
    flow.preset("notBackedUp");
    expect(flow.vaultBackup()).toMatchObject({ state: "stale", lastPush: null });
    flow.preset("backedUp");
    expect(flow.vaultBackup().state).toBe("ok");
    flow.reset();
    expect(flow.vaultBackup().state).toBe("off");
    expect(flow.account().signedIn).toBe(false);
  });

  it("gets the latest: two files the first time, then up to date", () => {
    const { flow } = make();
    expect(flow.latest()).toMatchObject({ outcome: "fastForward", changed: ["library/launch-checklist.md", "library/reading-list.md"] });
    expect(flow.latest().outcome).toBe("upToDate");
    flow.queueLatest("upToDate", "changes");
    expect(flow.latest().outcome).toBe("upToDate");
    expect(flow.latest().outcome).toBe("fastForward");
  });

  it("writes a backup file into the chosen folder, which the status then names", () => {
    const { flow, clock } = make();
    expect(flow.vaultFile()).toEqual({ backupFolder: null, backupFile: null });
    flow.setFolder("/Users/maya/Dropbox/KastenFlow backups");
    expect(flow.vaultFile().backupFile).toMatchObject({ state: "unconfirmed", lastWritten: null });
    expect(flow.file()).toMatchObject({ written: true, path: "/Users/maya/Dropbox/KastenFlow backups/kastenflow-vault.bundle" });
    expect(flow.vaultFile()).toMatchObject({ backupFolder: "/Users/maya/Dropbox/KastenFlow backups", backupFile: { state: "ok", lastWritten: clock.now() } });
    flow.setFolder(null);
    expect(flow.vaultFile().backupFile).toBeNull();
  });

  it("browses a pretend disk with the places backups live in", () => {
    expect(listing().folders.map((f) => f.name)).toEqual(["Backups", "Notes"]);
    const home = listing("/Users/maya");
    expect(home.parent).toBeNull();
    expect(home.folders.map((f) => f.name)).toEqual(["Desktop", "Documents", "Dropbox", "Google Drive", "OneDrive"]);
    expect(listing("/Users/maya/Dropbox").parent).toBe("/Users/maya");
    expect(listing("/etc").path).toBe("/Users/maya/Documents");
  });

  it("sends what waits when told to back up now", () => {
    const { flow } = make();
    flow.preset("backedUp");
    expect(flow.backupNow()).toEqual({ answer: "nothingToDo" });
    flow.waiting = 3;
    expect(flow.backupNow()).toEqual({ answer: "done", sent: 3 });
    expect(flow.waiting).toBe(0);
  });
});
