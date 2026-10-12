// The few parts of the browser's extension API this extension uses, as Chrome
// and Edge give them (promises, in Manifest V3). Only the two entry files and
// `browser.ts` use `chrome`; everything else is written against `env.ts`.

interface ChromeEvent<Listener> {
  addListener(listener: Listener): void;
}

interface ChromeTab {
  id?: number;
  url?: string;
  title?: string;
}

interface ChromeMenuClick {
  menuItemId: string | number;
  pageUrl?: string;
  linkUrl?: string;
  srcUrl?: string;
  selectionText?: string;
}

declare const chrome: {
  runtime: { onInstalled: ChromeEvent<() => void> };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
  };
  tabs: { query(info: { active: boolean; currentWindow: boolean }): Promise<ChromeTab[]> };
  scripting: { executeScript(injection: { target: { tabId: number }; func: () => unknown }): Promise<{ result?: unknown }[]> };
  contextMenus: {
    create(properties: { id: string; title: string; contexts: string[] }): void;
    removeAll(): Promise<void>;
    onClicked: ChromeEvent<(info: ChromeMenuClick, tab?: ChromeTab) => void>;
  };
  action: {
    setBadgeText(details: { text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  };
};
