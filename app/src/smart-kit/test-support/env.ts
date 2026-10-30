// Test helpers for the smart kit: load its plain scripts into jsdom, and a small
// fake host that speaks the bridge contract (requests `{id, kind, args}`, answers
// `{id, ok, value | error}`, events `{event: init | watch | theme}`).

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Kit = any;

const RAW = import.meta.glob<string>(["../**/*.js"], { query: "?raw", import: "default", eager: true });
// The kit proper: starter pages and map data are not part of "the kit's scripts".
export const kitFiles = (): string[] => Object.keys(RAW).map((k) => k.replace("../", "")).filter((f) => !f.startsWith("starters/") && !f.startsWith("data/"));
export const kitSource = (file: string): string => RAW[`../${file}`] ?? "";

export const CORE = ["kit.js", "lib/dom.js", "lib/dates.js", "lib/format.js", "lib/keys.js"];
export const COMPONENTS = [
  "components/legend.js",
  "components/charts.js",
  "components/countdown.js",
  "components/gallery.js",
  "components/table.js",
  "components/stat.js",
  "components/timeline.js",
  "components/kanban.js",
  "components/calendar.js",
  "components/map.js",
];
/** Data scripts, loaded after the components that read them. */
export const DATA = ["data/world-110m.js"];

/** Fresh kit in the jsdom window (each test starts from nothing). */
export function loadKit(files: string[] = [...CORE, ...COMPONENTS, ...DATA]): Kit {
  const w = window as any;
  w.kit?.stop?.();
  delete w.kit;
  delete w.kasten;
  document.documentElement.removeAttribute("data-theme");
  for (const f of files) (0, eval)(kitSource(f));
  return w.kit;
}

type Reply = unknown | ((args: any, request: any) => unknown);

export interface FakeHost {
  sent: any[];
  transport: { post(message: any): void; listen(fn: (m: unknown) => void): void };
  /** Answer by kind: a value, or a function (throw `{code, message}` to fail). */
  on(kind: string, reply: Reply): void;
  answer(id: number, value?: unknown): void;
  fail(id: number, code: string, message: string): void;
  emit(event: Record<string, unknown>): void;
  raw(message: unknown): void;
  ofKind(kind: string): any[];
}

export function fakeHost(initial: Record<string, Reply> = {}): FakeHost {
  const handlers = new Map<string, Reply>(Object.entries(initial));
  const sent: any[] = [];
  let listener: (m: unknown) => void = () => {};
  const answer = (id: number, value?: unknown) => listener(value === undefined ? { id, ok: true } : { id, ok: true, value });
  const fail = (id: number, code: string, message: string) => listener({ id, ok: false, error: { code, message } });
  return {
    sent,
    transport: {
      post(m) {
        sent.push(m);
        if (!handlers.has(m.kind)) return;
        const reply = handlers.get(m.kind);
        void Promise.resolve().then(() => {
          try {
            answer(m.id, typeof reply === "function" ? (reply as any)(m.args, m) : reply);
          } catch (e) {
            const err = e as { code?: string; message?: string };
            fail(m.id, err.code ?? "refused", err.message ?? "no");
          }
        });
      },
      listen: (fn) => {
        listener = fn;
      },
    },
    on: (kind, reply) => void handlers.set(kind, reply),
    answer,
    fail,
    emit: (e) => listener(e),
    raw: (m) => listener(m),
    ofKind: (kind) => sent.filter((m) => m.kind === kind),
  };
}

/** Let promise callbacks and microtask redraws run. */
export const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

export function mountPoint(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}
