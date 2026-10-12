// Chrome's and Edge's own objects, fitted to what the rest of the extension
// asks for (`env.ts`). The only file besides the two entries that names `chrome`.
import { readPage } from "./page.js";
export const storage = chrome.storage.local;
/** Runs `readPage` in a tab; null when the browser will not (its own pages, the web store). */
export const readTab = async (tabId) => {
    try {
        const [first] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage });
        return first?.result ?? null;
    }
    catch {
        return null;
    }
};
/** The tab in front in the window the popup opened from. */
export async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}
/** A tick or a mark on the toolbar button; an empty text takes it off. */
export function badge(text, ok) {
    void chrome.action.setBadgeText({ text });
    if (text)
        void chrome.action.setBadgeBackgroundColor({ color: ok ? "#2f7d4f" : "#b3402f" });
}
export const send = (url, init) => fetch(url, init);
