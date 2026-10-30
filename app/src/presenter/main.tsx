// The presenter's window's page (presenter.html): the speaker's view of a talk, and nothing of the app. It loads only the view, the
// link to the window that presents, and the app's styles; it takes the theme from the storage the main window keeps it in, and
// never tells the core a theme (that is the main window's to remember).

import { createRoot } from "react-dom/client";

import { loadTheme, resolveTheme } from "../features/workspace/theme";
import PresenterApp from "../features/slides/PresenterApp";
import "../styles.css";

const pref = loadTheme();
document.documentElement.dataset.theme = resolveTheme(pref);
if (pref === "system" && typeof window.matchMedia === "function") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    document.documentElement.dataset.theme = resolveTheme("system");
  });
}

const name = new URLSearchParams(location.search).get("presenter");
const root = document.getElementById("root");
if (root && name) createRoot(root).render(<PresenterApp name={name} />);
