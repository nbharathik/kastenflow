// Where the graph's nodes were left, kept per scope in this window's storage
// so a graph opens settled instead of starting again from a spiral. Nodes are
// kept by a hash of their id (a short number, not a long path), the places
// rounded, and only the few scopes used last. Losing it costs a layout, so
// every read and write may fail.

const PREFIX = "kasten.graph.places:";
const INDEX = "kasten.graph.places";
/** Scopes whose places are kept; the one used longest ago goes first. */
const KEPT = 8;

/** A short number for an id, FNV-1a. */
export function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface Stored {
  /** Hashes of the ids. */
  k: number[];
  /** x, y pairs, one pair for each hash. */
  p: number[];
}

/** The places of nodes by id hash, from storage or from the picture last drawn. */
export class Places {
  private readonly at = new Map<number, [number, number]>();

  /** With `persist` off nothing is read from or written to storage: places last only as long as this object. */
  constructor(
    private scope: string,
    private readonly persist = true,
  ) {
    this.read();
  }

  /** Forgets every place of this scope, here and in storage: the next layout starts afresh. */
  clear(): void {
    this.at.clear();
    if (!this.persist) return;
    try {
      localStorage.removeItem(PREFIX + this.scope);
    } catch {
      // Nothing kept to forget.
    }
  }

  /** Starts on another scope's places. */
  switchTo(scope: string): void {
    if (scope === this.scope) return;
    this.scope = scope;
    this.at.clear();
    this.read();
  }

  private read(): void {
    if (!this.persist) return;
    try {
      const raw = localStorage.getItem(PREFIX + this.scope);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Stored>;
      if (!Array.isArray(saved.k) || !Array.isArray(saved.p)) return;
      saved.k.forEach((hash, i) => {
        const [x, y] = [saved.p![2 * i], saved.p![2 * i + 1]];
        if (typeof hash === "number" && typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) this.at.set(hash, [x, y]);
      });
    } catch {
      // Nothing kept, or unreadable: the graph lays itself out.
    }
  }

  /** The starting places for these ids (x, y pairs, NaN for a node not seen before) and how many were known. */
  start(ids: readonly string[]): { start: Float64Array; known: number } {
    const start = new Float64Array(ids.length * 2).fill(Number.NaN);
    let known = 0;
    ids.forEach((id, i) => {
      const found = this.at.get(idHash(id));
      if (!found) return;
      start[2 * i] = found[0];
      start[2 * i + 1] = found[1];
      known++;
    });
    return { start, known };
  }

  /** Notes where these ids are now (x, y pairs). */
  remember(ids: readonly string[], positions: ArrayLike<number>): void {
    ids.forEach((id, i) => {
      const [x, y] = [positions[2 * i], positions[2 * i + 1]];
      if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) this.at.set(idHash(id), [x, y]);
    });
  }

  /** Writes what is known to storage. */
  save(): void {
    if (!this.persist) return;
    try {
      const k: number[] = [];
      const p: number[] = [];
      for (const [hash, [x, y]] of this.at) {
        k.push(hash);
        p.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
      }
      localStorage.setItem(PREFIX + this.scope, JSON.stringify({ k, p } satisfies Stored));
      const others = (JSON.parse(localStorage.getItem(INDEX) ?? "[]") as unknown[]).filter((s): s is string => typeof s === "string" && s !== this.scope);
      const used = [this.scope, ...others];
      for (const old of used.slice(KEPT)) localStorage.removeItem(PREFIX + old);
      localStorage.setItem(INDEX, JSON.stringify(used.slice(0, KEPT)));
    } catch {
      // Storage full or unavailable: the places are lost with the window.
    }
  }
}
