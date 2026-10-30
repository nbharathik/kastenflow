// What stands in for a plugin's view while the plugin is off: the file as a
// row, one sentence, and the button that turns the plugin on. The file itself
// is in the vault and untouched; turning the plugin on opens it in this tab.

import { useState, type ReactNode } from "react";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { CATALOG } from "./catalog";
import { pluginLabel, turnOnSentence, turnPluginOn } from "./off";

/** A file's name as people read it: no folder, no extension, dashes as spaces. */
const titleOfFile = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/(\.[a-z0-9]+)+$/i, "");
  return name.replace(/[-_]/g, " ").trim() || path;
};

/** The turn-on button, with the reason it did not work under it. */
export function TurnOn({ plugin, className = "" }: { plugin: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const press = async () => {
    setBusy(true);
    setProblem(null);
    const why = await turnPluginOn(plugin);
    setProblem(why);
    setBusy(false);
  };
  return (
    <div className={`flex flex-col items-start gap-1.5 ${className}`}>
      <Button tone="primary" size="sm" disabled={busy} onClick={() => void press()}>
        {`Turn on ${pluginLabel(plugin)}`}
      </Button>
      {problem && (
        <p role="alert" className="text-13 text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

/** The view of a plugin that is off, for the plugin whose view id is `view` and the file `path` it was asked to open. */
export function PluginOffView({ view, path }: { view: string; path?: string }) {
  const plugin = view.replace(/^plugin:/, "");
  const entry = CATALOG.find((e) => e.manifest.id === plugin);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-6 py-10">
      <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
        <Icon name={entry?.manifest.icon ?? "diagram"} className="size-5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-14 font-medium">{path ? titleOfFile(path) : (entry?.manifest.name ?? plugin)}</p>
          <p className="text-13 text-muted">{turnOnSentence(plugin)}</p>
        </div>
        <TurnOn plugin={plugin} />
      </div>
      <p className="text-13 text-muted">The file stays in your vault, and its picture still shows in pages, slides and whiteboards.</p>
    </div>
  );
}

/** The Settings page of a plugin that is off. */
export function PluginOffNote({ plugin, children }: { plugin: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-13 text-muted">{children}</p>
      <TurnOn plugin={plugin} />
    </div>
  );
}
