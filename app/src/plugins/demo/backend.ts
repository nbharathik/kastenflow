// The plugins backend of the demo: the three plugins with their switches, and
// downloads that fill a bar in about two seconds and then say they are ready.
// Settings → Plugins is the real screen. Nothing is downloaded.

import { DOWNLOAD_STEPS, STEP_MS, type DemoClock } from "../../demo/clock";
import { BROWSER_MANIFEST } from "../browser/manifest";
import { DIAGRAMS_MANIFEST } from "../diagrams/manifest";
import { LATEX_MANIFEST } from "../latex/manifest";
import type { PayloadEvent, PayloadStatus, PluginInfo, PluginsBackend } from "../api";
import type { PluginManifest } from "../types";

interface Payload {
  label: string;
  version: string;
  sizeBytes: number;
}

const PAYLOADS: Record<string, Payload> = {
  diagrams: { label: "draw.io editor", version: "26.0.0", sizeBytes: 48_000_000 },
  latex: { label: "Tectonic", version: "0.15.0", sizeBytes: 27_000_000 },
};

const MANIFESTS: readonly PluginManifest[] = [DIAGRAMS_MANIFEST, LATEX_MANIFEST, BROWSER_MANIFEST];

export interface PluginsDemoOptions {
  /** Told after a download finished or was removed, so the editor's own state follows. */
  changed?(id: string): void;
}

export class PluginsDemo implements PluginsBackend {
  private on: Record<string, boolean> = {};
  private installed: Record<string, boolean> = {};
  private handlers = new Set<(event: PayloadEvent) => void>();
  private running = new Map<string, { stop: () => void; end: (done: string) => void }>();

  constructor(
    private readonly clock: DemoClock,
    private readonly options: PluginsDemoOptions = {},
  ) {
    this.reset();
  }

  /** Where a recording starts: draw.io on and ready, LaTeX and the browser off. */
  reset(): void {
    for (const run of this.running.values()) run.stop();
    this.running.clear();
    this.on = { diagrams: true, latex: false, browser: false };
    this.installed = { diagrams: true, latex: false };
  }

  isOn = (id: string): boolean => this.on[id] === true;
  isInstalled = (id: string): boolean => this.installed[id] === true;

  /** The browser's switch from outside the plugin list (Settings → Browser). */
  setOn(id: string, on: boolean): void {
    this.on[id] = on;
  }

  /** Records that a program is (or is no longer) downloaded, telling nobody. */
  setInstalled(id: string, installed: boolean): void {
    this.installed[id] = installed;
  }

  /** Marks a program as downloaded without the wait. */
  preinstall(id: string): void {
    this.installed[id] = true;
    this.options.changed?.(id);
  }

  private tell(event: PayloadEvent): void {
    for (const handler of [...this.handlers]) handler(event);
  }

  async list(): Promise<PluginInfo[]> {
    return MANIFESTS.map((m) => ({
      id: m.id,
      name: m.name,
      summary: m.summary,
      version: m.version,
      defaultOn: m.defaultOn,
      scope: m.scope,
      payload: PAYLOADS[m.id] ?? null,
      enabled: this.isOn(m.id),
    }));
  }

  async setEnabled(id: string, on: boolean): Promise<boolean> {
    const changed = this.isOn(id) !== on;
    this.on[id] = on;
    return changed;
  }

  async status(id: string): Promise<PayloadStatus> {
    const payload = PAYLOADS[id];
    const installed = this.isInstalled(id);
    return { id, state: installed ? "ready" : "idle", installed, busy: this.running.has(id), version: installed ? (payload?.version ?? null) : null, sizeBytes: payload?.sizeBytes ?? 0 };
  }

  install(id: string): Promise<string> {
    const total = PAYLOADS[id]?.sizeBytes ?? 0;
    return new Promise((resolve) => {
      let step = 0;
      let cancel: (() => void) | null = null;
      const end = (done: string) => {
        cancel?.();
        this.running.delete(id);
        resolve(done);
      };
      const tick = () => {
        step++;
        if (step >= DOWNLOAD_STEPS) {
          this.installed[id] = true;
          this.tell({ id, state: "ready", done: total, total });
          this.options.changed?.(id);
          return end("installed");
        }
        this.tell({ id, state: "downloading", done: Math.round((total * step) / DOWNLOAD_STEPS), total });
        cancel = this.clock.after(STEP_MS, tick);
      };
      cancel = this.clock.after(STEP_MS, tick);
      this.running.set(id, { stop: () => cancel?.(), end });
    });
  }

  async cancel(id: string): Promise<void> {
    const run = this.running.get(id);
    if (!run) return;
    this.tell({ id, state: "cancelled", done: 0, total: PAYLOADS[id]?.sizeBytes ?? 0 });
    run.end("cancelled");
  }

  async remove(id: string): Promise<void> {
    this.installed[id] = false;
    this.tell({ id, state: "idle", done: 0, total: PAYLOADS[id]?.sizeBytes ?? 0 });
    this.options.changed?.(id);
  }

  async onPayload(handler: (event: PayloadEvent) => void): Promise<() => void> {
    this.handlers.add(handler);
    return () => void this.handlers.delete(handler);
  }
}
