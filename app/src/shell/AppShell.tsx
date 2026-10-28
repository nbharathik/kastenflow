import { lazy, Suspense, useEffect } from "react";

import { loadNotePage } from "../features/workspace/page/LazyNotePage";
import { usePlugins } from "../plugins/registry";
import { forgetProjectSmart } from "../features/smart/availability";
import { forgetRunSwitch } from "../features/smart/run-switch";
import { Palette } from "../features/workspace/overlays/Palette";
import { SideStack } from "../features/stack/SideStack";
import { VaultChooser } from "../features/vaults/VaultChooser";
import { ShortcutsHelp } from "../features/workspace/overlays/ShortcutsHelp";
import { Toasts } from "../features/workspace/overlays/Toasts";
import { useKeyLabel, withKey } from "../features/shortcuts/store";
import { useGlobalShortcuts } from "../features/workspace/shortcuts";
import { useWindowTitle } from "./window-title";
import { useWeeklyCheck } from "../features/workspace/weekly-check";
import { startLive } from "../features/workspace/status";
import { startBackupLook } from "../features/backup/look";
import { useKeepSafeStep } from "../features/backup/told-up-front";
import { useDesktopEvents } from "./desktop-events";
import { useWorkspace } from "../features/workspace/store";
import { connectVault, type Connection } from "../features/workspace/vault";
import { useShell } from "../lib/store";
import { useFileDropGuard } from "./file-drops";
import { useWebLinks } from "./web-links";
import { useMouseNavigation } from "./mouse-nav";
import { useSystemMenu } from "./native-menu";
import { useWritesOnClose } from "../features/workspace/page/close-writes";
import { useDrawForAgents } from "../features/diagrams/draw-png";
import { useSelectionShare } from "../features/chat/selection/sharing";
import { useShowWhenDrawn } from "./window-ready";
import { useFirstPage } from "../features/vaults/first-page";
import { Tooltips } from "../ui/Tooltips";
import { ViewBoundary } from "../ui/ViewBoundary";
import { useStoryboard } from "../features/pages/present/storyboard/state";
import { useSlideNumbers } from "../features/slides/slide-numbers-state";
import { useExportRequest } from "../features/projects/export/request";
import { useSaveSetupRequest } from "../features/projects/setups/request";
import { useBackupWizard } from "../features/backup/wizard";
import { usePaperDialog } from "../features/references/add-state";
import { useCompareDialog } from "../features/sources/compare/compare-state";
import { PagePeek } from "./peek/PagePeek";
import { OpenMenuHost } from "./open-menu";
import { useDiagramHost } from "../features/diagrams/host-store";
import { useUpdates } from "../features/updates/store";
import { useUpdatesAtStart } from "../features/updates/start";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { preloadViews } from "./lazy-views";
import { Panes } from "./Panes";

// The chat's code loads when it is first opened, and What's new when a
// release is shown.
const ChatDock = lazy(() => import("../features/chat/ChatDock").then((m) => ({ default: m.ChatDock })));
const WhatsNew = lazy(() => import("../features/updates/WhatsNew"));
// The diagram host (the editor in a modal, pictures drawn again off screen) loads only once a diagram asks for it.
const DiagramHost = lazy(() => import("../features/diagrams/DiagramHost"));
// The storyboard of a page and "turn slide numbers off in every deck" bring the slide engine: they load when one is asked for.
const SlidesOverlays = lazy(() => import("../features/slides/SlidesOverlays"));
// "Add a paper" and "Compare papers" load when one is asked for.
const ResearchOverlays = lazy(() => import("../features/references/ResearchOverlays"));
// "Export a project" (a bundle in a folder) loads when it is asked for.
const ExportProject = lazy(() => import("../features/projects/export/ExportProject"));
const SaveSetup = lazy(() => import("../features/projects/setups/SaveSetup"));
// "Keep your notes safe", the guided backup setup, loads when it is asked for.
const BackupWizard = lazy(() => import("../features/backup/wizard/WizardHost"));
// The template gallery (with the starter kits and its previews) and the "Move to" picker load when they are opened.
const TemplateGallery = lazy(() => import("../features/templates/TemplateGallery").then((m) => ({ default: m.TemplateGallery })));
const MovePicker = lazy(() => import("../features/workspace/overlays/MovePicker").then((m) => ({ default: m.MovePicker })));

/** Loads and warms the page editor while the window is idle, so the first
 * page opens at once instead of waiting for the editor's code. */
function preloadEditor(): void {
  if (import.meta.env.MODE === "test") return;
  const load = () =>
    void loadNotePage()
      .then(() => import("../features/pages/editor/warm"))
      .then((warm) => warm.warmEditor())
      .catch(() => {});
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(load, { timeout: 2000 });
  else setTimeout(load, 300);
}

export interface AppShellProps {
  /** Opens this instead of the vault the environment names (tests). */
  connect?: () => Promise<Connection>;
}

export function AppShell({ connect = connectVault }: AppShellProps) {
  const sidebarOpen = useShell((s) => s.sidebarOpen);
  const focusMode = useShell((s) => s.focusMode);
  const paletteOpen = useShell((s) => s.paletteOpen);
  const shortcutsOpen = useShell((s) => s.shortcutsOpen);
  const moving = useShell((s) => s.moving);
  const gallery = useShell((s) => s.gallery);
  const stackOpen = useWorkspace((s) => s.stackOpen);
  const chatOpen = useShell((s) => s.chatOpen);
  const ready = useWorkspace((s) => s.ready);
  const problem = useWorkspace((s) => s.problem);
  const choosing = useWorkspace((s) => s.choosing);
  const whatsNew = useUpdates((s) => s.open);
  const diagramsWork = useDiagramHost((s) => s.modal !== null || s.picker !== null || s.queue.length > 0 || s.pngs.length > 0);
  const storyboarding = useStoryboard((s) => s.request !== null);
  const numbering = useSlideNumbers((s) => s.open);
  const slidesDialog = storyboarding || numbering;
  const addingPaper = usePaperDialog((s) => s.request !== null);
  const comparing = useCompareDialog((s) => s.request !== null);
  const exporting = useExportRequest((s) => s.request !== null);
  const savingSetup = useSaveSetupRequest((s) => s.request !== null);
  const settingUpBackup = useBackupWizard((s) => s.open);
  useGlobalShortcuts();
  useWindowTitle();
  useWeeklyCheck();
  useFileDropGuard();
  useWebLinks();
  useMouseNavigation();
  useSystemMenu();
  useWritesOnClose();
  // What an agent asks of the window through the app: a diagram drawn as a PNG, and the selection it reads.
  useDrawForAgents();
  useSelectionShare();
  useShowWhenDrawn();
  useUpdatesAtStart();
  useDesktopEvents();
  useFirstPage();
  useKeepSafeStep();

  useEffect(() => {
    let cancelled = false;
    let stopLive: (() => void) | null = null;
    let stopLook: (() => void) | null = null;
    connect().then(
      async (connection) => {
        if (cancelled) return;
        await useWorkspace.getState().connect(connection);
        if (!cancelled && connection.client) {
          stopLive = startLive(connection.client);
          stopLook = startBackupLook();
        }
        if (!cancelled) {
          preloadEditor();
          preloadViews();
          // Smart pages are on or off for each vault, so what was heard before this connection is forgotten.
          forgetRunSwitch();
          forgetProjectSmart();
          void usePlugins.getState().sync();
        }
      },
      (err: unknown) => !cancelled && void useWorkspace.getState().connect({ client: null, problem: String(err) }),
    );
    return () => {
      cancelled = true;
      stopLive?.();
      stopLook?.();
    };
  }, [connect]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && !focusMode && !choosing && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col">
          {focusMode && <FocusBar />}
          {!ready ? (
            <p className="p-8 text-14 text-muted">Opening your notes…</p>
          ) : choosing ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <VaultChooser problem={problem} />
            </div>
          ) : problem ? (
            <Problem text={problem} />
          ) : (
            <div className="flex min-h-0 flex-1" data-peek-closes>
              <Panes />
              {stackOpen && !focusMode && <SideStack />}
              {chatOpen && !focusMode && (
                <ViewBoundary place="chat">
                  <Suspense fallback={null}>
                    <ChatDock />
                  </Suspense>
                </ViewBoundary>
              )}
            </div>
          )}
        </main>
      </div>
      {!focusMode && <StatusBar />}
      {paletteOpen && <Palette />}
      {shortcutsOpen && <ShortcutsHelp />}
      {moving && (
        <Suspense fallback={null}>
          <MovePicker path={moving} />
        </Suspense>
      )}
      {gallery && (
        <Suspense fallback={null}>
          <TemplateGallery />
        </Suspense>
      )}
      <PagePeek />
      <OpenMenuHost />
      {diagramsWork && (
        <Suspense fallback={null}>
          <DiagramHost />
        </Suspense>
      )}
      {slidesDialog && (
        <Suspense fallback={null}>
          <SlidesOverlays />
        </Suspense>
      )}
      {(addingPaper || comparing) && (
        <Suspense fallback={null}>
          <ResearchOverlays />
        </Suspense>
      )}
      {exporting && (
        <Suspense fallback={null}>
          <ExportProject />
        </Suspense>
      )}
      {savingSetup && (
        <Suspense fallback={null}>
          <SaveSetup />
        </Suspense>
      )}
      {settingUpBackup && (
        <Suspense fallback={null}>
          <BackupWizard />
        </Suspense>
      )}
      {whatsNew && (
        <Suspense fallback={null}>
          <WhatsNew />
        </Suspense>
      )}
      <Toasts />
      <Tooltips />
    </div>
  );
}

function FocusBar() {
  const key = useKeyLabel("focus");
  return (
    <div className="group flex h-8 shrink-0 items-center justify-end px-3">
      <button
        type="button"
        onClick={useShell.getState().toggleFocus}
        className="rounded px-2 py-0.5 text-12 text-muted opacity-0 transition-opacity hover:bg-line/50 group-hover:opacity-100 focus:opacity-100"
      >
        {withKey("Exit focus mode", key)}
      </button>
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <section className="mx-auto mt-24 max-w-md px-6 text-center">
      <h1 className="text-20 font-semibold">No vault open</h1>
      <p className="mt-2 text-14 text-muted">{text}</p>
    </section>
  );
}
