// The diagram editor's side of the demo: it counts as installed once the
// plugin's download is ready (or from the start), a download fills a bar in
// about two seconds, and the editor's page is the stand-in (demo/page.ts).

import { DOWNLOAD_STEPS, STEP_MS, type DemoClock } from "../../../demo/clock";
import type { EditorBackend, EditorInfo, InstallProgress } from "../editor";

export const EDITOR_BYTES = 48_000_000;

export class EditorDemo implements EditorBackend {
  private stop: (() => void) | null = null;
  private end: ((done: "installed" | "cancelled") => void) | null = null;

  constructor(
    private readonly clock: DemoClock,
    /** Whether the plugin's download is ready, and a way to mark it so. */
    private readonly ready: { get(): boolean; set(on: boolean): void },
  ) {}

  async status(): Promise<EditorInfo> {
    return { version: "26.0.0", bytes: EDITOR_BYTES, url: "", installed: this.ready.get(), busy: this.end !== null };
  }

  install(onProgress: (progress: InstallProgress) => void): Promise<"installed" | "cancelled"> {
    return new Promise((resolve) => {
      let step = 0;
      const finish = (done: "installed" | "cancelled") => {
        this.stop?.();
        this.stop = null;
        this.end = null;
        resolve(done);
      };
      const tick = () => {
        step++;
        if (step >= DOWNLOAD_STEPS) {
          this.ready.set(true);
          return finish("installed");
        }
        onProgress({ phase: "downloading", done: Math.round((EDITOR_BYTES * step) / DOWNLOAD_STEPS), total: EDITOR_BYTES });
        this.stop = this.clock.after(STEP_MS, tick);
      };
      this.stop = this.clock.after(STEP_MS, tick);
      this.end = finish;
    });
  }

  async cancel(): Promise<void> {
    this.end?.("cancelled");
  }

  async remove(): Promise<void> {
    this.ready.set(false);
  }
}
