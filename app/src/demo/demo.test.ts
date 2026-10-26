import { invoke } from "@tauri-apps/api/core";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { canBackUp, onSignIn, type SignInEnd } from "../features/backup/api";
import { setBrowserBackend } from "../features/browser/backend";
import { setPreviewBackend } from "../features/browser/preview-backend";
import { canSignInWithChatGpt } from "../features/chat/chatgpt";
import { connectChat } from "../features/chat/client";
import { editorPage, setDemoEditorPage, setEditorBackend, useDiagramEditor } from "../features/diagrams/editor";
import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { setPluginsBackend, pluginsBackend } from "../plugins/api";
import { setLatexBackend, latexBackend } from "../plugins/latex/backend";
import { inDemo, setDemoForTests } from "./flag";
import { installDemo } from "./index";

describe("the demo switch", () => {
  afterEach(() => setDemoForTests(null));

  it("is off without ?demo=1.2.2: the preview and the app behave as they did", () => {
    expect(inDemo()).toBe(false);
    expect(canBackUp()).toBe(false);
    expect(canSignInWithChatGpt()).toBe(false);
    expect(pluginsBackend()).toBeNull();
    expect(latexBackend()).toBeNull();
    expect(editorPage()).toBeNull();
    expect(window.__kastenDemo).toBeUndefined();
    expect(connectChat().kind).toBe("preview");
  });

  it("turns the gates the real screens read on, and only then", () => {
    setDemoForTests(true);
    expect(inDemo()).toBe(true);
    expect(canBackUp()).toBe(true);
    expect(canSignInWithChatGpt()).toBe(true);
  });
});

describe("installing the demo", () => {
  const vault = new MemoryVault({ "library/note.md": "---\ntype: page\ntitle: A note\n---\n# A note\n" });

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setDemoForTests(true);
    await installDemo(vault);
  });

  afterAll(() => {
    vi.useRealTimers();
    clearMocks();
    setPluginsBackend(null);
    setLatexBackend(null);
    setEditorBackend(null);
    setDemoEditorPage(null);
    setBrowserBackend(null);
    setPreviewBackend(null);
    delete window.__kastenDemo;
  });

  it("leaves a hook for the recorder, with the names the scenes click", () => {
    const demo = window.__kastenDemo!;
    expect(demo.version).toBe("1.2.2");
    expect(demo.names.backup.getLatest).toBe("Get latest");
    expect(demo.names.chat.prompt).toBe(demo.chat.prompt);
    expect(demo.state()).toMatchObject({ signedIn: false, remote: null, backup: { state: "off" }, plugins: { diagrams: true, latex: false, browser: false }, installed: { diagrams: true, latex: false } });
  });

  it("says the vault's backup is off until the first backup is made", async () => {
    const status = await vault.status();
    expect(status).toMatchObject({ history: true, remote: null, backup: { state: "off" } });
  });

  it("answers the desktop app's commands over the real invoke, and tells a sign-in's end by event", async () => {
    expect(await invoke("github_account")).toMatchObject({ signedIn: false, canSignIn: true, suggested: "kastenflow-vault" });
    const ends: SignInEnd[] = [];
    const stop = onSignIn((end) => ends.push(end));
    // The listener is registered through the same commands; let that finish.
    await vi.advanceTimersByTimeAsync(0);
    expect(await invoke("github_sign_in_start")).toMatchObject({ userCode: "WDJB-MJHT" });
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(0);
    expect(ends).toEqual([{ state: "signed", login: "maya-notes" }]);
    expect(await invoke("github_account")).toMatchObject({ signedIn: true, login: "maya-notes" });
    stop();
  });

  it("makes the first backup in three seconds and then the status bar's data reads backed up", async () => {
    const made = invoke("github_create_backup", { name: "kastenflow-vault" });
    await vi.advanceTimersByTimeAsync(3100);
    expect(await made).toMatchObject({ fullName: "maya-notes/kastenflow-vault", visibility: "private" });
    const status = await vault.status();
    expect(status.remote).toBe("https://github.com/maya-notes/kastenflow-vault.git");
    expect(status.backup).toMatchObject({ state: "ok", failures: 0 });
    expect(status.backup.lastPush).not.toBeNull();
    expect(await vault.pushNow()).toMatchObject({ state: "ok" });
  });

  it("fails a command it does not know, as a plain browser does", async () => {
    await expect(invoke("open_vault")).rejects.toThrow("needs the desktop app");
  });

  it("signs in with ChatGPT in a blink", async () => {
    expect(await invoke("chatgpt_account")).toMatchObject({ signedIn: false });
    await invoke("chatgpt_sign_in_start");
    await vi.advanceTimersByTimeAsync(200);
    expect(await invoke("chatgpt_account")).toMatchObject({ signedIn: true, email: "maya@example.com" });
  });

  it("serves the plugins, the LaTeX document, the stand-in editor and the stored drawing", async () => {
    expect((await pluginsBackend()!.list()).map((p) => p.id)).toEqual(["diagrams", "latex", "browser"]);
    expect((await latexBackend()!.docs()).map((d) => d.title)).toEqual(["Notes on a derivation"]);
    await useDiagramEditor.getState().refresh();
    expect(useDiagramEditor.getState().info).toMatchObject({ installed: true });
    expect(editorPage()).toMatch(/^data:text\/html;charset=utf-8,/);
    const [diagram] = await vault.diagrams();
    expect(diagram).toMatchObject({ title: "Backup flow", preview: "fresh" });
    expect(await vault.diagramPreview(diagram!.path)).toContain("Private GitHub repo");
  });

  it("does not open windows of its own, and keeps a note of what was asked", () => {
    expect(window.open("https://github.com/login/device")).toBeNull();
    expect(window.__kastenDemo!.state().opened).toEqual(["https://github.com/login/device"]);
  });
});
