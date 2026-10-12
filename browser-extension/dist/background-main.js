// The extension's service worker: it makes the right-click menu once, when the
// extension is installed or updated, and sends what a click chose to Kasten.
import { makeMenus, onMenuClick } from "./background.js";
import { badge, readTab, send, storage } from "./browser.js";
const env = {
    storage,
    read: readTab,
    send,
    badge,
    addMenu: (item) => chrome.contextMenus.create({ id: item.id, title: item.title, contexts: [...item.contexts] }),
    clearMenus: () => chrome.contextMenus.removeAll(),
    later: (then, ms) => void setTimeout(then, ms),
};
chrome.runtime.onInstalled.addListener(() => void makeMenus(env));
chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClick(env, { ...info, menuItemId: String(info.menuItemId) }, tab));
