import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";

// First: an earlier preview's samples go before anything reads storage.
import "./features/workspace/preview/fresh-start";
import { usePrefs } from "./features/workspace/prefs";
import { applyMotion, watchSystemMotion } from "./lib/motion";
import { startZoom } from "./lib/zoom";
import { applyAccent, applyTheme, watchSystemTheme } from "./features/workspace/theme";
import { AppShell } from "./shell/AppShell";
import { watchProblems } from "./shell/problems";
import { ViewBoundary } from "./ui/ViewBoundary";
import "./styles.css";
// The page palette (option, tag and text colours) every view uses.
import "./features/pages/editor/styles/tokens.css";

// Before the first paint, so a dark window never flashes white.
applyTheme(usePrefs.getState().theme);
applyAccent(usePrefs.getState().accent);
watchSystemTheme(() => usePrefs.getState().theme);
applyMotion(usePrefs.getState().motion);
watchSystemMotion(() => usePrefs.getState().motion);
// The level of this display (the last one shown, until the display is known); the presenter's window has no zoom of its own.
if (!new URLSearchParams(location.search).has("presenter")) startZoom();

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

// A failure anywhere is said and survived, never a blank window.
watchProblems();

/** Forgets the saved tabs and recent pages, never notes, and starts again:
 * the way out if a saved layout keeps the window from drawing. */
function resetLayout(): void {
  try {
    for (const key of ["kasten.layout", "kasten.recent"]) localStorage.removeItem(key);
  } catch {
    // No storage: nothing was saved.
  }
  location.reload();
}

// In the browser preview the presenter's window is this page with `?presenter=…`: it draws the speaker's view of a talk, not the app.
// The desktop app's presenter window has a page of its own (presenter.html) and loads none of the app.
const presenter = new URLSearchParams(location.search).get("presenter");
const PresenterApp = lazy(() => import("./features/slides/PresenterApp"));

createRoot(root).render(
  presenter ? (
    <Suspense fallback={null}>
      <PresenterApp name={presenter} />
    </Suspense>
  ) : (
    <StrictMode>
      <ViewBoundary place="app" reset={{ label: "Reset the layout", run: resetLayout }}>
        <AppShell />
      </ViewBoundary>
    </StrictMode>
  ),
);
