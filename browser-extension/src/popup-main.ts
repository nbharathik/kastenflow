// The popup's entry: fits the browser to `PopupEnv` and starts it in the page.

import { activeTab, badge, readTab, send, storage } from "./browser.js";
import { startPopup } from "./popup.js";

const root = document.getElementById("app");
if (root) {
  void startPopup(
    {
      storage,
      activeTab,
      read: readTab,
      send,
      clearBadge: () => badge("", true),
      close: () => window.close(),
      browser: /\bEdg\//.test(navigator.userAgent) ? "Edge" : "Chrome",
    },
    root,
  );
}
