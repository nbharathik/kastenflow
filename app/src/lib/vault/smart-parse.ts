// The schema check for what a smart page sends: `parseBridgeRequest` accepts a
// message only when every field has the right type and size, and builds a fresh
// object from the fields it knows, so nothing else a page adds goes further.

import {
  ERROR_KINDS,
  FILTER_OPS,
  MAX_QUERY_LIMIT,
  bridgeError,
  type BridgeError,
  type BridgeRequest,
  type ErrorKind,
  type FilterOp,
  type Props,
  type QuerySpec,
  type SmartFilter,
  type SmartSort,
} from "./smart-contract";

const SHORT = 1024;
const MESSAGE = 10_000;
const TEXT = 1_000_000;
const MAX_ID = 0xffffffff;
const MAX_ITEMS = 200;
const MAX_DEPTH = 8;

class Bad extends Error {}

function bad(message: string): never {
  throw new Bad(message);
}

type Raw = Record<string, unknown>;

function isPlain(v: unknown): v is Raw {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function obj(v: unknown, what: string): Raw {
  return isPlain(v) ? v : bad(`${what} must be an object.`);
}

function str(o: Raw, key: string, max = SHORT, allowEmpty = false): string {
  const v = o[key];
  if (typeof v !== "string") return bad(`${key} must be text.`);
  if (v.length > max) return bad(`${key} is too long.`);
  if (!allowEmpty && v === "") return bad(`${key} must not be empty.`);
  return v;
}

function optStr(o: Raw, key: string, max = SHORT): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, max, true);
}

function int(o: Raw, key: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v)) return bad(`${key} must be a whole number.`);
  if (v < min || v > max) return bad(`${key} must be ${min} to ${max}.`);
  return v;
}

function optInt(o: Raw, key: string, min: number, max: number): number | undefined {
  return o[key] === undefined ? undefined : int(o, key, min, max);
}

function list(o: Raw, key: string, max = MAX_ITEMS): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) return bad(`${key} must be a list.`);
  if (v.length > max) return bad(`${key} has too many items.`);
  return v;
}

function strList(o: Raw, key: string): string[] {
  return list(o, key).map((item) => (typeof item === "string" && item !== "" && item.length <= SHORT ? item : bad(`${key} holds an item that is not short text.`)));
}

/** Values one message may hold, counted over everything in it; a bigger message is refused before it is walked. */
const MAX_NODES = 5_000;

/** Whether `v` is plain data. `budget.left` counts the values still allowed, so a message cannot make the window walk a huge list or many lists. */
function isJson(v: unknown, budget: { left: number }, depth = 0): boolean {
  if (depth > MAX_DEPTH || --budget.left < 0) return false;
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.length <= budget.left && v.every((item) => isJson(item, budget, depth + 1));
  if (isPlain(v)) {
    const keys = Object.keys(v);
    return keys.length <= budget.left && keys.every((k) => k !== "__proto__" && isJson(v[k], budget, depth + 1));
  }
  return false;
}

/** Plain data within the budget of one message. */
function plain(v: unknown): boolean {
  return isJson(v, { left: MAX_NODES });
}

function props(v: unknown, what: string): Props {
  const o = obj(v, what);
  if (Object.keys(o).length > MAX_ITEMS) return bad(`${what} has too many keys.`);
  return plain(o) ? o : bad(`${what} may hold only plain data, and not much of it.`);
}

function filter(v: unknown): SmartFilter {
  const o = obj(v, "a filter");
  const out: SmartFilter = { key: str(o, "key") };
  if (o.op !== undefined) {
    if (!(FILTER_OPS as readonly unknown[]).includes(o.op)) return bad("A filter op is not one that exists.");
    out.op = o.op as FilterOp;
  }
  if (o.value !== undefined) {
    if (!plain(o.value)) return bad("A filter value may hold only plain data, and not much of it.");
    out.value = o.value;
  }
  return out;
}

function sort(v: unknown): SmartSort {
  const o = obj(v, "a sort");
  const out: SmartSort = { key: str(o, "key") };
  if (o.dir !== undefined) {
    if (o.dir !== "asc" && o.dir !== "desc") return bad("A sort dir must be asc or desc.");
    out.dir = o.dir;
  }
  return out;
}

function query(v: unknown): QuerySpec {
  const o = obj(v, "a query");
  const out: QuerySpec = { tag: str(o, "tag") };
  if (o.filter !== undefined) out.filter = list(o, "filter", 20).map(filter);
  if (o.sort !== undefined) out.sort = list(o, "sort", 10).map(sort);
  const limit = optInt(o, "limit", 1, MAX_QUERY_LIMIT);
  if (limit !== undefined) out.limit = limit;
  return out;
}

/** The object without its undefined keys, so an absent option stays absent. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function noArgs(raw: Raw): void {
  const a = raw.args;
  if (a === undefined || a === null) return;
  if (!isPlain(a) || Object.keys(a).length > 0) bad("This call takes no arguments.");
}

function parse(raw: unknown): BridgeRequest {
  const top = obj(raw, "The message");
  const id = int(top, "id", 0, MAX_ID);
  const kind = str(top, "kind");
  if (kind === "project" || kind === "theme") {
    noArgs(top);
    return { id, kind };
  }
  const a = obj(top.args, "args");
  switch (kind) {
    case "query":
      return { id, kind, args: query(a) };
    case "list":
      return { id, kind, args: defined({ project: optStr(a, "project"), tag: optStr(a, "tag"), type: optStr(a, "type") }) };
    case "read":
      return { id, kind, args: { id: str(a, "id") } };
    case "search":
      return { id, kind, args: defined({ q: str(a, "q"), limit: optInt(a, "limit", 1, MAX_QUERY_LIMIT) }) };
    case "journal": {
      const date = str(a, "date");
      return /^\d{4}-\d{2}-\d{2}$/.test(date) ? { id, kind, args: { date } } : bad("date must look like 2026-10-22.");
    }
    case "tasks": {
      if (a.done !== undefined && typeof a.done !== "boolean") bad("done must be true or false.");
      return { id, kind, args: defined({ project: optStr(a, "project"), tag: optStr(a, "tag"), done: a.done as boolean | undefined }) };
    }
    case "board":
      return { id, kind, args: { path: str(a, "path") } };
    case "watch":
      return { id, kind, args: { watchId: str(a, "watchId"), query: query(a.query) } };
    case "unwatch":
      return { id, kind, args: { watchId: str(a, "watchId") } };
    case "open":
      return { id, kind, args: { target: str(a, "target") } };
    case "resize":
      return { id, kind, args: { px: int(a, "px", 1, 100_000) } };
    case "log": {
      const items = list(a, "args", 20);
      return plain(items) ? { id, kind, args: { args: items } } : bad("log holds something that is not plain data, or too much of it.");
    }
    case "report": {
      if (!(ERROR_KINDS as readonly unknown[]).includes(a.kind)) bad("kind is not an error kind.");
      const message = str(a, "message", MESSAGE, true);
      return { id, kind, args: defined({ kind: a.kind as ErrorKind, message, source: optStr(a, "source"), line: optInt(a, "line", 0, MAX_ID) }) };
    }
    case "update":
      return { id, kind, args: { id: str(a, "id"), props: props(a.props, "props") } };
    case "addTags":
      return { id, kind, args: { id: str(a, "id"), tags: strList(a, "tags") } };
    case "createNote": {
      const args = defined({
        title: str(a, "title"),
        tags: a.tags === undefined ? undefined : strList(a, "tags"),
        props: a.props === undefined ? undefined : props(a.props, "props"),
        body: optStr(a, "body", TEXT),
        project: optStr(a, "project"),
      });
      return { id, kind, args };
    }
    case "append":
      return { id, kind, args: { id: str(a, "id"), md: str(a, "md", TEXT, true) } };
    case "toggleTodo":
      return { id, kind, args: { id: str(a, "id"), index: int(a, "index", 0, MAX_ID) } };
    default:
      return bad(`"${kind.slice(0, 40)}" is not a call the bridge knows.`);
  }
}

/** A request the page sent, checked and rebuilt, or a `bad_request` saying what is wrong. */
export function parseBridgeRequest(raw: unknown): BridgeRequest | BridgeError {
  try {
    return parse(raw);
  } catch (e) {
    if (e instanceof Bad) return bridgeError("bad_request", e.message);
    throw e;
  }
}

/** Whether `parseBridgeRequest` refused the message. */
export function isBridgeError(v: BridgeRequest | BridgeError): v is BridgeError {
  return "code" in v;
}

/** The id of a message, when it has a usable one, so even a refused message can be answered. */
export function requestIdOf(raw: unknown): number | null {
  if (!isPlain(raw)) return null;
  const id = raw.id;
  return typeof id === "number" && Number.isInteger(id) && id >= 0 && id <= MAX_ID ? id : null;
}
