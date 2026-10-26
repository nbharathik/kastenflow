// The promo demo (`?demo=1.2.2` in the browser preview): canned, deterministic
// stand-ins behind the real screens of five features, so a recording can
// show them in the preview. This file is loaded only then, from the preview's
// vault connection; the desktop app and the plain preview never parse it.
//
//   backup        the desktop app's commands, answered from a small state machine
//   Sign in with ChatGPT, and the chat's proposed changes (features/chat/demo)
//   plugins       the three switches and fake downloads
//   LaTeX         a document whose "build" makes a PDF of the source
//   diagrams      a stored drawing in place of the editor's frame
//   browser       a canned page in the tab and in link previews
//
// Nothing is saved or sent. `window.__kastenDemo` resets it and sets up scenes.

import { backupCommands } from "../features/backup/demo/commands";
import { BackupFlow, type LatestKind, type Preset } from "../features/backup/demo/flow";
import { patchVault } from "../features/backup/demo/vault";
import { useBackupStatus } from "../features/backup/use-backup-status";
import { useBackupWizard } from "../features/backup/wizard/state";
import { setBrowserBackend } from "../features/browser/backend";
import { demoBrowser, demoPreview } from "../features/browser/demo/backend";
import { DemoViews } from "../features/browser/demo/views";
import { setPreviewBackend } from "../features/browser/preview-backend";
import { useBrowserPrefs } from "../features/browser/prefs";
import { chatgptCommands, ChatGptDemo } from "../features/chat/demo/chatgpt";
import { DEMO_PROMPT } from "../features/chat/demo/plan";
import { EditorDemo } from "../features/diagrams/demo/editor";
import { FLOW_TITLE, FLOW_XML, flowSvg } from "../features/diagrams/demo/flow";
import { editorAddress } from "../features/diagrams/demo/page";
import { setDemoEditorPage, setEditorBackend, useDiagramEditor } from "../features/diagrams/editor";
import { useVaultStatus } from "../features/workspace/status";
import { useWorkspace } from "../features/workspace/store";
import type { VaultClient } from "../lib/vault/types";
import { PluginsDemo } from "../plugins/demo/backend";
import { setPluginsBackend } from "../plugins/api";
import { setLatexBackend } from "../plugins/latex/backend";
import { LatexDemo } from "../plugins/latex/demo/backend";
import { DEMO_MAIN } from "../plugins/latex/demo/source";
import { LATEX_VIEW } from "../plugins/latex/manifest";
import { DIAGRAMS_VIEW } from "../plugins/diagrams/manifest";
import { usePlugins } from "../plugins/registry";
import { pageClock } from "./clock";
import { addCommands, emitEvent, installIpc } from "./ipc";
import { NAMES } from "./names";

/** What a recording can call on `window.__kastenDemo`. */
export interface KastenDemo {
  readonly version: "1.2.2";
  /** The words the scenes click. */
  readonly names: typeof NAMES;
  /** Back to where a recording starts: signed out, no backup, plugins as the app starts them. */
  reset(): Promise<void>;
  /** What the fakes hold now, for a script that checks. */
  state(): Record<string, unknown>;
  backup: {
    /** Where the status bar starts: `off` ("Backup off"), `notBackedUp` (amber "Not backed up yet") or `backedUp`. */
    preset(name: Preset): Promise<void>;
    /** Makes the last backup `minutes` old ("Backed up 2 minutes ago"). */
    ageMinutes(minutes: number): Promise<void>;
    /** The next Get latest answers: `changes` brings in two files, `upToDate` nothing. */
    queueLatest(...next: LatestKind[]): void;
  };
  plugins: {
    /** Marks a download as done without the wait. */
    preinstall(id: "diagrams" | "latex"): Promise<void>;
    /** Turns a plugin on or off as the switch does. */
    set(id: "diagrams" | "latex" | "browser", on: boolean): Promise<void>;
  };
  /** Gives three pages a version each, so History lists some saves. */
  seedHistory(): Promise<number>;
  /** Opens the demo's LaTeX document (turns LaTeX on, its program ready). */
  openLatex(): Promise<void>;
  /** Opens the demo's diagram in the editor area. */
  openDiagram(): Promise<void>;
  chat: { prompt: string };
}

declare global {
  interface Window {
    __kastenDemo?: KastenDemo;
  }
}

/** The diagram the demo draws, made through the vault's own ops (once). */
async function seedDiagram(client: VaultClient): Promise<string | null> {
  try {
    const known = (await client.diagrams()).find((d) => d.title === FLOW_TITLE);
    if (known) return known.path;
    const path = await client.createDiagram(FLOW_TITLE, null, FLOW_XML);
    await client.saveDiagramPreview(path, flowSvg(), (await client.diagram(path)).hash);
    return path;
  } catch {
    return null;
  }
}

/** A line of text added to three pages, as a person's saves would be. */
async function addSaves(client: VaultClient): Promise<number> {
  const notes = (await client.list()).filter((n) => (n.kind === "page" || n.kind === "card") && !n.path.startsWith("chats/")).sort((a, b) => a.title.localeCompare(b.title)).slice(0, 3);
  for (const note of notes) await client.append(note.path, "Reviewed this week.");
  return notes.length;
}

export async function installDemo(client: VaultClient): Promise<void> {
  const clock = pageClock;
  const tell = (event: string, payload: unknown) => void emitEvent(event, payload);

  // Backup and Sign in with ChatGPT: the desktop app's commands.
  const flow = new BackupFlow(clock, tell);
  const chatgpt = new ChatGptDemo(clock, tell);
  patchVault(client, flow);
  addCommands({ ...backupCommands(flow), ...chatgptCommands(chatgpt) });
  await installIpc();

  // Plugins, with the editor and the browser following their switches.
  const plugins = new PluginsDemo(clock, { changed: (id) => id === "diagrams" && void useDiagramEditor.getState().refresh() });
  setPluginsBackend(plugins);
  const latex = new LatexDemo(clock);
  setLatexBackend(latex);
  setEditorBackend(new EditorDemo(clock, { get: () => plugins.isInstalled("diagrams"), set: (on) => plugins.setInstalled("diagrams", on) }));
  setDemoEditorPage(editorAddress());
  const views = new DemoViews(clock);
  setBrowserBackend(demoBrowser(views, { get: () => plugins.isOn("browser"), set: (on) => plugins.setOn("browser", on) }));
  setPreviewBackend(demoPreview(views));
  await seedDiagram(client);

  // No window opens on its own in a recording.
  const opened: string[] = [];
  window.open = ((url?: string | URL) => {
    opened.push(String(url ?? ""));
    return null;
  }) as typeof window.open;

  const refresh = async () => {
    await Promise.all([useVaultStatus.getState().refresh(), useBackupStatus.getState().refresh()]);
  };

  window.__kastenDemo = {
    version: "1.2.2",
    names: NAMES,
    async reset() {
      flow.reset();
      chatgpt.reset();
      plugins.reset();
      latex.reset();
      views.clear();
      useBackupWizard.getState().reset();
      useBrowserPrefs.setState({ enabled: false, known: true });
      await Promise.all([refresh(), usePlugins.getState().sync()]);
    },
    state: () => ({
      signedIn: flow.signedIn,
      remote: flow.remote,
      lastPush: flow.lastPush,
      backup: flow.vaultBackup(),
      chatgpt: chatgpt.signedIn,
      plugins: { diagrams: plugins.isOn("diagrams"), latex: plugins.isOn("latex"), browser: plugins.isOn("browser") },
      installed: { diagrams: plugins.isInstalled("diagrams"), latex: plugins.isInstalled("latex") },
      latexBuilds: latex.built,
      views: views.count,
      opened: [...opened],
    }),
    backup: {
      async preset(name) {
        flow.preset(name);
        await refresh();
      },
      async ageMinutes(minutes) {
        flow.ageMinutes(minutes);
        await refresh();
      },
      queueLatest: (...next) => flow.queueLatest(...next),
    },
    plugins: {
      async preinstall(id) {
        plugins.preinstall(id);
        await usePlugins.getState().sync();
      },
      async set(id, on) {
        await usePlugins.getState().setEnabled(id, on);
      },
    },
    seedHistory: () => addSaves(client),
    async openLatex() {
      plugins.preinstall("latex");
      await usePlugins.getState().sync();
      await usePlugins.getState().setEnabled("latex", true);
      useWorkspace.getState().go({ view: LATEX_VIEW, path: DEMO_MAIN });
    },
    async openDiagram() {
      const path = await seedDiagram(client);
      if (!path) return;
      await usePlugins.getState().setEnabled("diagrams", true);
      useWorkspace.getState().go({ view: DIAGRAMS_VIEW, path });
    },
    chat: { prompt: DEMO_PROMPT },
  };
}
