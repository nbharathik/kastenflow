// Talking to Kasten: three requests to 127.0.0.1, with what went wrong said in
// words a person can act on. No cookies, no referrer, never to any other address.

import type { Fetch } from "./env.js";
import type { CaptureRequest, Paired, Saved, Targets } from "./model.js";

/** What kind of trouble a request ran into. */
export type Trouble =
  /** Nothing answered: Kasten is closed, or the port is another. */
  | "closed"
  /** Kasten answered that the extension door is off, or the vault is still opening. */
  | "off"
  /** The token is not (or no longer) one Kasten knows. */
  | "unpaired"
  /** Kasten turned the request away (a wrong pairing code, a wrong place). */
  | "refused"
  /** The capture was not something Kasten can keep. */
  | "invalid"
  /** Over the size a capture may be. */
  | "too-big"
  /** Too many requests in a minute. */
  | "busy"
  | "other";

export class KastenError extends Error {
  constructor(
    readonly trouble: Trouble,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "KastenError";
  }
}

/** How long a request may take: a big page is read and written in a second or two. */
const TIMEOUT_MS = 20_000;

/** The address Kasten's extension routes are on. */
export const baseUrl = (port: number): string => `http://127.0.0.1:${port}`;

function troubleOf(status: number): Trouble {
  switch (status) {
    case 401:
      return "unpaired";
    case 403:
      return "refused";
    case 503:
      return "off";
    case 413:
      return "too-big";
    case 429:
      return "busy";
    case 400:
    case 404:
    case 415:
    case 422:
      return "invalid";
    default:
      return "other";
  }
}

export class Kasten {
  constructor(
    private readonly port: number,
    private readonly token: string | null,
    private readonly send: Fetch = (url, init) => fetch(url, init),
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    let response: Response;
    try {
      response = await this.send(`${baseUrl(this.port)}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new KastenError("closed", `KastenFlow did not answer at 127.0.0.1:${this.port}. Open KastenFlow, and in Settings → Browser extension turn the extension on and check the port.`);
    }
    let answer: unknown = null;
    try {
      answer = await response.json();
    } catch {
      // A reply that is not JSON is not Kasten's.
    }
    if (!response.ok) {
      const said = answer && typeof answer === "object" && "error" in answer && typeof answer.error === "string" ? answer.error : "";
      const trouble = troubleOf(response.status);
      throw new KastenError(trouble, said || `KastenFlow refused that (${response.status}).`, response.status);
    }
    if (!answer || typeof answer !== "object") throw new KastenError("other", "That did not look like an answer from KastenFlow.", response.status);
    return answer as T;
  }

  /** Trades a pairing code for a token. `label` names this browser in Kasten's list. */
  pair(code: string, label: string): Promise<Paired> {
    return this.call<Paired>("POST", "/v1/pair", { code: code.trim(), label });
  }

  /** The places a capture can go. */
  targets(): Promise<Targets> {
    return this.call<Targets>("GET", "/v1/targets");
  }

  /** Keeps a capture. */
  capture(request: CaptureRequest): Promise<Saved> {
    return this.call<Saved>("POST", "/v1/capture", request);
  }
}
